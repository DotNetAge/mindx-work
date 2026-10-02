/**
 * mw CLI（MindX Work 命令行入口）：把插件的安装/管理能力传导给终端 Agent，
 * 实现「Agent 自己扩展自己」——mx-plugin-dev 技能产出插件包 → mw 安装 → app 即时激活。
 * 运行形态 = Electron 二进制子命令（ELECTRON_RUN_AS_NODE=1，node-pty 同机制先例）：
 * 此模式下 electron API 不可用，故只依赖 plugin-store（纯 Node）。
 * Agent 消费约定：--json 输出机器可读回执；人读输出面向终端用户。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, chmodSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPluginStore, MARKET_MAX_ZIP_BYTES, type InstalledPluginView } from './plugin-store'

/** 与 electron-builder productName 一致（userData 目录名；勿改，改则 CLI 找不到 app 数据） */
const APP_NAME = 'MindX Work'

/** 按平台推导 app userData 根（与 Electron app.getPath('userData') 默认规则一致） */
function defaultUserDataRoot(): string {
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME)
    case 'win32':
      return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), APP_NAME)
    default:
      return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), APP_NAME)
  }
}

/** 存储根：MW_PLUGIN_ROOT 环境变量覆盖（诊断与多实例调试用），缺省按平台推导 */
const store = createPluginStore(process.env.MW_PLUGIN_ROOT ?? path.join(defaultUserDataRoot(), 'plugins'))

/** 机器可读回执（--json）：成功 { ok: true, data }；失败 { ok: false, error } */
interface CliResult {
  ok: boolean
  data?: unknown
  error?: string
}

function emit(result: CliResult, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } else if (!result.ok) {
    process.stderr.write(`mw: ${result.error}\n`)
  }
  process.exitCode = result.ok ? 0 : 1
}

function humanList(views: InstalledPluginView[]): string {
  if (views.length === 0) return '（尚未安装在线插件）'
  return views
    .map((v) => `${v.enabled ? '已启用' : '已停用'}  ${v.id}  ${v.version}（${v.versions.length} 个版本）`)
    .join('\n')
}

/** 从 URL 或本地路径安装：URL 走市场管线（SSRF 防线 + sha256），本地 zip 直读 */
async function installFrom(spec: string): Promise<InstalledPluginView> {
  if (/^https?:\/\//.test(spec)) return store.installFromUrl(spec)
  const file = path.resolve(spec)
  if (!existsSync(file)) throw new Error(`文件不存在：${file}`)
  if (statSize(file) > MARKET_MAX_ZIP_BYTES) throw new Error('插件包超过大小上限（50MB）')
  const data = new Uint8Array(readFileSync(file))
  return store.installZipData(data)
}

function statSize(file: string): number {
  return statSync(file).size
}

/** 生成 mw wrapper 到 ~/.mindx/bin（mindx 同款路径——其安装器已在 shell rc 导入该目录，
 * 规避写 /usr/local/bin 的系统权限问题）；rc 全无导入行时补写 .zshrc 并提示生效方式 */
function installCli(): string {
  if (process.platform === 'win32') throw new Error('Windows 平台的 CLI 安装请手动将应用目录加入 PATH')
  const electronBin = process.execPath
  // tsc 以 cjs 输出（electron tsconfig module=commonjs），__filename 即 dist/cli.js 绝对路径
  const cliJs = __filename
  const binDir = path.join(os.homedir(), '.mindx', 'bin')
  mkdirSync(binDir, { recursive: true })
  const script = [
    '#!/bin/bash',
    `# MindX Work 插件 CLI（由 mw install-cli 生成于 ${new Date().toISOString()}）`,
    `exec env ELECTRON_RUN_AS_NODE=1 "${electronBin}" "${cliJs}" "$@"`,
    '',
  ].join('\n')
  const target = path.join(binDir, 'mw')
  writeFileSync(target, script, 'utf8')
  chmodSync(target, 0o755)

  // PATH 导入检查（仿 mindx rc 纪律）：已有 .mindx/bin 导入行则不动；全无才补 .zshrc
  const rcFiles = ['.zshrc', '.bashrc', '.bash_profile', '.profile'].map((f) => path.join(os.homedir(), f))
  const hasImport = rcFiles.some((rc) => {
    try {
      return readFileSync(rc, 'utf8')
        .split('\n')
        .some((line) => line.startsWith('export PATH="') && line.includes('.mindx/bin'))
    } catch {
      return false
    }
  })
  let hinted = false
  if (!hasImport) {
    const zshrc = path.join(os.homedir(), '.zshrc')
    writeFileSync(zshrc, `\n# MindX Work\nexport PATH="$HOME/.mindx/bin:$PATH"\n`, { flag: 'a' })
    hinted = true
  }
  if (hinted) {
    process.stderr.write('已在 ~/.zshrc 追加 PATH 导入行；执行 source ~/.zshrc 或重开终端生效\n')
  }
  return target
}

const HELP = [
  'mw — MindX Work 命令行工具',
  '',
  '用法：',
  '  mw plugin list [--json]                 列出已安装插件',
  '  mw plugin install <url|本地zip> [--json]  安装插件包（市场 URL 或本地文件）',
  '  mw plugin uninstall <id> [--json]        卸载插件（删除全部版本）',
  '  mw plugin enable <id> [--json]           启用插件',
  '  mw plugin disable <id> [--json]          停用插件',
  '  mw plugin use <id> <version> [--json]    切换激活版本（回滚）',
  '  mw plugin export <id> [目标zip] [--json]  导出激活版本为 zip',
  '  mw install-cli                          把 mw 安装到 ~/.mindx/bin（mindx 同款 PATH 目录）',
  '',
  '说明：安装/卸载/启停立即落盘；正在运行的 MindX Work 会自动感知并激活。',
].join('\n')

async function main(argv: string[]): Promise<void> {
  const json = argv.includes('--json')
  const args = argv.filter((a) => a !== '--json')
  const [head, sub, ...rest] = args

  if (head === 'install-cli' || (head === 'cli' && sub === 'install')) {
    const target = installCli()
    emit({ ok: true, data: { path: target } }, json)
    if (!json) process.stdout.write(`已安装：${target}\n`)
    return
  }
  if (head !== 'plugin' || !sub) {
    emit({ ok: false, error: HELP }, json)
    if (!json) process.stdout.write(`${HELP}\n`)
    process.exitCode = head === 'help' || head === '--help' || head === '-h' ? 0 : 1
    return
  }

  try {
    switch (sub) {
      case 'list': {
        const views = store.list()
        emit({ ok: true, data: views }, json)
        if (!json) process.stdout.write(`${humanList(views)}\n`)
        return
      }
      case 'install': {
        if (!rest[0]) throw new Error('缺少安装来源：<url|本地zip>')
        const view = await installFrom(rest[0])
        emit({ ok: true, data: view }, json)
        if (!json) process.stdout.write(`已安装 ${view.id}@${view.version}\n`)
        return
      }
      case 'uninstall': {
        if (!rest[0]) throw new Error('缺少插件 id')
        if (!store.uninstall(rest[0])) throw new Error(`插件不存在：${rest[0]}`)
        emit({ ok: true, data: { id: rest[0] } }, json)
        if (!json) process.stdout.write(`已卸载 ${rest[0]}\n`)
        return
      }
      case 'enable':
      case 'disable': {
        if (!rest[0]) throw new Error('缺少插件 id')
        if (!store.setEnabled(rest[0], sub === 'enable')) throw new Error(`插件不存在：${rest[0]}`)
        emit({ ok: true, data: { id: rest[0], enabled: sub === 'enable' } }, json)
        if (!json) process.stdout.write(`已${sub === 'enable' ? '启用' : '停用'} ${rest[0]}\n`)
        return
      }
      case 'use': {
        if (!rest[0] || !rest[1]) throw new Error('用法：mw plugin use <id> <version>')
        if (!store.setActiveVersion(rest[0], rest[1])) throw new Error(`插件或版本不存在：${rest[0]}@${rest[1]}`)
        emit({ ok: true, data: { id: rest[0], version: rest[1] } }, json)
        if (!json) process.stdout.write(`已切换 ${rest[0]} → ${rest[1]}\n`)
        return
      }
      case 'export': {
        if (!rest[0]) throw new Error('缺少插件 id')
        const view = store.list().find((p) => p.id === rest[0])
        if (!view) throw new Error(`插件不存在：${rest[0]}`)
        const target = rest[1] ?? `${rest[0]}-${view.version}.zip`
        const written = store.exportToFile(rest[0], target)
        emit({ ok: true, data: { path: written } }, json)
        if (!json) process.stdout.write(`已导出：${written}\n`)
        return
      }
      default:
        throw new Error(`未知子命令：mw plugin ${sub}（--help 查看用法）`)
    }
  } catch (error) {
    emit({ ok: false, error: error instanceof Error ? error.message : String(error) }, json)
  }
}

main(process.argv.slice(2))
