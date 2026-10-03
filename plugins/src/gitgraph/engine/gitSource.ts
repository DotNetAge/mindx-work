/**
 * git 数据源：经 Electron 宿主 pty 桥（window.mxDesktop.terminal）跑一次性
 * 只读 git 命令。通道实证：terminal 插件即消费此桥（TerminalPanel.vue 的
 * TerminalBridgeShape），daemon RPC 无通用命令执行方法（mindx 侧
 * handler_registry.go 全表核对，仅 git.clone / git.commit_message 两个专用
 * 方法）；pty 是交互 shell（$SHELL -l），输出混 prompt / 命令回显 / ANSI
 * 转义，用 BEGIN / END 哨兵切出干净 stdout：每条命令以 printf BEGIN 开头、
 * 以 printf END_<exitcode> 结尾，两哨兵之间即命令原生输出（回显落在 BEGIN
 * 之前被丢弃）。命令白名单硬编码，只读，任何写操作拒绝执行。
 */

import type { FileDiff, FileEntry, GitCommit, GitRef } from '../types'

/** 提交记录 format：字段以 \x1f 分隔、记录以 \x1e 收尾（控制字符，提交正文可视为不含） */
const LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%b%x1f%D%x1f%P%x1e'

/** 只读命令白名单（硬编码：禁止任何写操作命令经此通道执行） */
const READONLY_COMMANDS = new Set(['log', 'branch', 'status', 'rev-parse', 'diff-tree', 'show', 'diff'])

/** 单命令执行超时（命令写入由 tty 行规程缓冲，shell 就绪早晚不影响执行） */
const COMMAND_TIMEOUT = 30000

const BEGIN_MARK = '__MXG_BEGIN__'
const END_MARK_RE = /__MXG_END_(\d+)__/

/** ANSI 转义序列（CSI / OSC / 单字符）——pty 交互 shell 会给回显与 prompt 上色 */
// eslint-disable-next-line no-control-regex -- 剥离转义序列必须匹配控制字符，属有意使用
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

/** 宿主桥终端段形状（对齐 TerminalPanel.vue 消费契约，类型防纯 Web 裸取） */
export interface PtyBridge {
  create(cwd: string, cols: number, rows: number): Promise<string | null>
  write(id: string, data: string): Promise<boolean>
  kill(id: string): Promise<boolean>
  onData(listener: (payload: { id: string; data: string }) => void): () => void
  onExit(listener: (payload: { id: string }) => void): () => void
}

/** 取宿主 pty 桥（纯 Web 环境无桥返回 null，调用方呈可读空态） */
export function resolvePtyBridge(): PtyBridge | null {
  return (window as unknown as { mxDesktop?: { terminal?: PtyBridge } }).mxDesktop?.terminal ?? null
}

/** git 命令失败（message 已净化为可读文案，不透出 stderr 原文与路径） */
export class GitCommandError extends Error {}

/** 剥离 ANSI 转义与 pty 注入的回车（\n 在 pty 输出侧表现为 \r\n） */
function stripAnsi(raw: string): string {
  return raw.replace(ANSI_RE, '').replace(/\r/g, '')
}

/** 单引号包裹（参数均由代码内拼装，此处防御任意引号字符） */
function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", `'\\''`)}'`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 按 git 退出码 + 输出特征映射可读错误（stderr 原文不透出） */
function humanizeGitFailure(output: string): string {
  if (output.includes('not a git repository')) return '当前目录不是 Git 仓库'
  if (output.includes('does not have any commits yet')) return '仓库还没有任何提交'
  return '读取 Git 数据失败'
}

/**
 * 一次性 git 命令会话：open 创建 pty（交互 shell），run 逐条跑命令，
 * close 收尾。轮内复用同一会话（shell 启动 2-10 秒只等一次）。
 */
export class GitShellSession {
  private id: string | null = null
  private buffer = ''
  private exited = false
  private offData: (() => void) | null = null
  private offExit: (() => void) | null = null

  private constructor(private readonly bridge: PtyBridge) {}

  /** 创建 pty 会话（桥缺失 / 创建失败抛可读错误） */
  static async open(bridge: PtyBridge, cwd: string): Promise<GitShellSession> {
    const session = new GitShellSession(bridge)
    // 订阅先于 create：防止首波输出早于监听注册而丢失（回调带 id 过滤）
    session.offData = bridge.onData(({ id, data }) => {
      if (id === session.id) session.buffer += data
    })
    session.offExit = bridge.onExit(({ id }) => {
      if (id === session.id) session.exited = true
    })
    // 列宽给大（200）：pretty format 单行记录不被交互 shell 折行影响（折行仅显示层，但宽行减少视觉噪声）
    const id = await bridge.create(cwd, 200, 50)
    if (!id) throw new Error('终端会话创建失败（需要桌面端环境）')
    session.id = id
    return session
  }

  /** 执行一条只读 git 命令，返回哨兵间干净 stdout；非 0 退出抛 GitCommandError */
  async run(args: string[]): Promise<string> {
    if (!this.id) throw new Error('终端会话未创建')
    const head = args[0] ?? ''
    if (!READONLY_COMMANDS.has(head)) {
      throw new Error(`拒绝执行非只读命令：${head}`)
    }
    // 哨兵字面量在命令串内拆段拼接（shell 相邻拼接语义不变）：交互 shell 会回显
    // 整条命令行，若回显含连续哨兵字面量，提取时 indexOf 会命中回显而非执行输出
    const command = [
      `printf '__MXG''_BEGIN__\\n'`,
      `git --no-pager -c core.quotepath=false -c color.ui=false ${args.map(shellQuote).join(' ')}`,
      `printf '\\n__MXG''_END_%s__' "$?"`,
    ].join('; ')
    this.buffer = ''
    if (!(await this.bridge.write(this.id, command + '\n'))) {
      throw new Error('终端会话写入失败')
    }
    const deadline = Date.now() + COMMAND_TIMEOUT
    while (!END_MARK_RE.test(this.buffer) && !this.exited && Date.now() < deadline) {
      await sleep(60)
    }
    // 全部匹配与切片都在剥离 ANSI 后的文本上做：原始流的 match.index 混着
    // 回显里的颜色码偏移，与剥离后文本错位，直接 slice 会切出垃圾（实测实锤）
    const text = stripAnsi(this.buffer)
    const match = END_MARK_RE.exec(text)
    if (!match) {
      if (this.exited) throw new Error('终端会话提前结束')
      throw new Error('读取 Git 数据超时，请重试')
    }
    // lastIndexOf：取执行输出的 BEGIN（回显中的字面量已被拆段，正常不出现）
    const beginAt = text.lastIndexOf(BEGIN_MARK)
    if (beginAt === -1) throw new Error('读取 Git 数据失败')
    const output = text.slice(beginAt + BEGIN_MARK.length, match.index).replace(/^\n+/, '')
    if (match[1] !== '0') throw new GitCommandError(humanizeGitFailure(output))
    return output
  }

  /** 关闭会话（幂等；会话已死时桥侧静默） */
  async close(): Promise<void> {
    this.offData?.()
    this.offData = null
    this.offExit?.()
    this.offExit = null
    if (this.id && this.bridge) void this.bridge.kill(this.id)
    this.id = null
  }
}

/** refs 装饰解析：%D 样例「HEAD -> main, origin/main, tag: v1.0」 */
function parseRefs(decorated: string): GitRef[] {
  const trimmed = decorated.trim()
  if (!trimmed) return []
  return trimmed.split(',').reduce<GitRef[]>((list, item) => {
    const t = item.trim()
    if (!t) return list
    if (t.startsWith('HEAD -> ')) list.push({ kind: 'head', name: t.slice(8) })
    else if (t === 'HEAD') list.push({ kind: 'head', name: 'HEAD' })
    else if (t.startsWith('tag: ')) list.push({ kind: 'tag', name: t.slice(5) })
    else if (t.includes('/')) list.push({ kind: 'remote', name: t })
    else list.push({ kind: 'local', name: t })
    return list
  }, [])
}

/** log 输出解析：记录按 \x1e 切（正文内换行不破坏记录结构），字段按 \x1f 切 */
function parseCommits(output: string): GitCommit[] {
  const list: GitCommit[] = []
  for (const record of output.split('\x1e')) {
    const trimmedRecord = record.replace(/^\n+/, '')
    if (!trimmedRecord.trim()) continue
    const fields = trimmedRecord.split('\x1f')
    if (fields.length < 9) continue
    // 正文若自身含 \x1f（极罕见），中段字段回并，保持首尾字段对位
    const body = fields.slice(6, fields.length - 2).join('\x1f')
    const hash = fields[0]?.trim() ?? ''
    const short = fields[1]?.trim() ?? ''
    const author = fields[2]?.trim() ?? ''
    const email = fields[3]?.trim() ?? ''
    const time = Number(fields[4])
    const subject = fields[5]?.trim() ?? ''
    const refsRaw = fields[fields.length - 2]?.trim() ?? ''
    const parentsRaw = fields[fields.length - 1]?.trim() ?? ''
    if (!hash) continue
    list.push({
      hash,
      short,
      author,
      email,
      time: Number.isFinite(time) ? time : 0,
      subject,
      body,
      refs: parseRefs(refsRaw),
      parents: parentsRaw ? parentsRaw.split(' ') : [],
    })
  }
  return list
}

export interface CommitPage {
  limit: number
  skip: number
  /** true = 全部分支（git log --all），false = 当前 HEAD */
  all: boolean
}

/** 拉一页提交（一条命令拿全：hash / 作者 / 时间 / 主题 / 正文 / 装饰 / 父） */
export async function fetchCommits(session: GitShellSession, page: CommitPage): Promise<GitCommit[]> {
  const args = ['log', `--pretty=format:${LOG_FORMAT}`, '-n', String(page.limit), `--skip=${page.skip}`]
  if (page.all) args.push('--all')
  return parseCommits(await session.run(args))
}

/** 当前分支名（游离 HEAD 时返回空串） */
export async function fetchCurrentBranch(session: GitShellSession): Promise<string> {
  return (await session.run(['branch', '--show-current'])).trim()
}

/** 仓库判定：是否 git 工作树内（非仓库走可读空态而非报错） */
export async function detectRepo(session: GitShellSession): Promise<boolean> {
  try {
    return (await session.run(['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
  } catch (e) {
    if (e instanceof GitCommandError && e.message === '当前目录不是 Git 仓库') return false
    throw e
  }
}

/**
 * name-status 行解析：`<status字母[分数]>\t<path>` 或 R/C 的
 * `<status[分数]>\t<oldPath>\t<path>`（tab 分隔；实测样例：`A\tpath`、
 * `R100\told\tnew`、`C083\told\tnew`）。空行与非 tab 行丢弃（show 前导空行）。
 */
export function parseNameStatus(output: string): FileEntry[] {
  const list: FileEntry[] = []
  for (const line of output.split('\n')) {
    if (!line.includes('\t')) continue
    const fields = line.split('\t')
    const head = fields[0] ?? ''
    const status = head[0]
    if (!status || !(status === 'A' || status === 'M' || status === 'D' || status === 'R' || status === 'C')) continue
    const first = fields[1]
    if (!first) continue
    const second = fields[2]
    if (second && (status === 'R' || status === 'C')) {
      list.push({ path: second, status, oldPath: first })
    } else if (!second) {
      list.push({ path: first, status })
    }
    // 其余形态（R/C 但缺双路径等异常输出）丢弃
  }
  return list
}

/**
 * 提交文件列表：常规提交走 diff-tree（一条命令拿全），根提交无父可比回退
 * show（--format= 抹掉提交头，仅剩 name-status 段）。-M -C 开启重命名/复制
 * 检测，与 log 页的提交数据解耦（展开时懒加载，非首载一并取）。
 */
export async function fetchCommitFiles(session: GitShellSession, hash: string, isRoot: boolean): Promise<FileEntry[]> {
  const args = isRoot
    ? ['show', '--name-status', '--format=', '-M', '-C', hash]
    : ['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', '-C', hash]
  return parseNameStatus(await session.run(args))
}

/** diff 文本大小上限：超过截断（UI 提示「文件过大，仅显示部分」） */
const DIFF_MAX_BYTES = 2 * 1024 * 1024

export interface FileDiffRequest {
  hash: string
  /** 第一父 hash（根提交不传） */
  parent?: string
  /** 参与 diff 的路径：常规 1 个（新路径）；R/C 传 [oldPath, path] 保留配对 */
  paths: string[]
  isRoot: boolean
}

/**
 * 单文件 unified diff：常规提交 `git diff -M -C <parent> <hash> -- <paths>`
 * （树间差异，merge 提交即相对第一父；-C 与 -M 并开，copy 条目才能配对出
 * copy from/to 头，实测仅 -M 时 C 条目退化为双文件独立 diff）；根提交
 * `git show --format= <hash> -- <paths>`。R/C 必须双路径过滤，实测仅传新
 * 路径会丢失 rename 配对（退化成 new file diff）。超 2MB 按字节截断
 * （TextDecoder 容错多字节边界），并按行收尾。
 */
export async function fetchFileDiff(session: GitShellSession, req: FileDiffRequest): Promise<FileDiff> {
  let args: string[]
  if (req.isRoot) {
    args = ['show', '--format=', req.hash, '--', ...req.paths]
  } else {
    if (!req.parent) throw new Error('无法定位该提交的父提交，diff 不可用')
    args = ['diff', '-M', '-C', req.parent, req.hash, '--', ...req.paths]
  }
  const text = await session.run(args)
  if (text.length <= DIFF_MAX_BYTES) return { text, truncated: false }
  const bytes = new TextEncoder().encode(text)
  let cut = new TextDecoder().decode(bytes.slice(0, DIFF_MAX_BYTES))
  const lastNl = cut.lastIndexOf('\n')
  if (lastNl > 0) cut = cut.slice(0, lastNl + 1)
  return { text: cut, truncated: true }
}
