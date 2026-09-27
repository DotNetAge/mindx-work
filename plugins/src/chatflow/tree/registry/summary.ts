// registry/summary.ts —— 名片文案 / 图标 / 组头摘要 / executing 流光文案的唯一对齐契约。
//
// 设计依据：PR-REFACTOR-CONVERSATION-TREE.md
// - §2.2 工具对照表（取舍 12）：显示名（动词）/ 图标 / 节点类型三者的对齐只发生在本表，
//   新增工具先补设计文档表格再在此登记，杜绝实现期即兴对齐；
// - §2.3：组头 summarize(n) 由成员类型推导——成员单一类型用该类型模板，混合类型用
//   groupKey 兜底模板，分组规则与组头措辞零特判；
// - §3.3：统一名片模板 = 图标 + 状态动词 + 对象 + 元信息徽标，各类型只定义「对象」与「徽标」；
// - §3.4：每类型声明 executing 流光文案（status === 'executing' 的名片渲染形态）；
// - §3.6：attention 静态类型（llm_retry / max_turns / compaction 成功也着黄色）；
//   时长徽标超阈值显示由树壳统一处理，不进各类型的 badges；
// - §4.2：表按全量 TreeNodeType 键控，漏类型编译报错。
// 结构化供给 ≠ 全量显示（取舍 18）：object/badges 只做精选投影，禁止 payload 原样 dump。
//
// 移植适配（mindx-work）：icon 由 Vue 组件改为 Iconify 名称字符串（界面军规 9：
// 图标一律 MxIcon + Iconify，禁手写 SVG 与多色图标集），消费方用 <MxIcon :name> 渲染。
// 桌面版 Element Plus 图标与自绘 SVG 到 lucide 名称的映射见移植计划附录 B。

import {
  agentRoleOf, basename, formatCompactNumber, formatDuration,
} from '../../toolViewUtils'
import { slotPresentationOf } from '../../slot/registry'
import type { GroupKey } from '../types/base'
import type { GroupNode } from '../types/content'
import type { ToolNode } from '../types/tool'
import type { TreeNode, TreeNodeType } from '../types'

/** 流光文案常量（§3.4）：content 流入 =「正在规划下一步」、thinking 流入 =「思考中」，
 *  名片与树尾 pending 行共用同一措辞来源。 */
export const CONTENT_EXECUTING_LABEL = '正在规划下一步'
export const THINKING_EXECUTING_LABEL = '思考中'

/**
 * 节点呈现契约。
 * verb / executing 支持「静态文案 | 按节点数据推导」两种形态（如 permission 的已授权/已拒绝）。
 * 泛型 N 收窄到具体节点类型，payload 字段拼写错误在编译期暴露。
 */
export interface NodePresentation<N extends TreeNode = TreeNode> {
  /** 图标：Iconify 名称（lucide 集合），消费方 <MxIcon :name="icon"> 渲染 */
  icon: string
  /** 状态动词（完成态）：已读取 / 已创建 / 命令已执行……无动词的卡传空串 */
  verb: string | ((node: N) => string)
  /** executing 流光文案 */
  executing: string | ((node: N) => string)
  /** 静态 attention 类型：成功也着黄色（§3.6） */
  attention?: boolean
  /** 名片「对象」：路径 / 命令 / 模式 / 标题等精选主体 */
  object: (node: N) => string
  /** 名片「元信息徽标」：±行数 / 命中数 / 状态词等，空串项会被过滤 */
  badges: (node: N) => string[]
  /** 组头单类型模板（§2.3，仅可聚合的工具类型声明；groupKey=null 的关键动作省略） */
  summarize?: (count: number) => string
}

/** 按判别字段取联合成员类型（判别联合不能直接以 TreeNode[K] 索引取成员） */
type NodeOfType<T extends TreeNodeType> = Extract<TreeNode, { type: T }>

type PresentationTable = { [K in TreeNodeType]: NodePresentation<NodeOfType<K>> }

// ── 小工具：文案投影 ───────────────────────────────────────────────────────

/** 压成单行并截断（名片不放多行文本） */
function singleLine(s: string, max = 120): string {
  const line = (s || '').replace(/\s+/g, ' ').trim()
  return line.length > max ? line.slice(0, max) + '…' : line
}

/** 以「 · 」连接非空片段 */
function joinObj(...parts: Array<string | number | undefined | null>): string {
  return parts.filter(p => p !== undefined && p !== null && String(p) !== '').map(String).join(' · ')
}

/** URL 取主机名（解析失败原样返回） */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/** 任务状态中文标签（未知状态原样显示） */
const TASK_STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
}
function taskStatusLabel(s: string): string {
  return TASK_STATUS_LABELS[s] || s
}

/** team_ops 动作中文标签（builder 归一为 delete/list/get_tasks） */
const TEAM_ACTION_LABELS: Record<string, string> = {
  delete: '已解散团队',
  list: '已查询团队',
  get_tasks: '已读取团队任务',
}

/**
 * subagent 名片对象的 Agent 角色查询数据源（summary 与 SubagentNodeView 共用）。
 * 四期接 agents 插件经 services 提供的已招募清单（形态 A 命令 + store 消费）；
 * 一期清单为空——agentRoleOf 回退显示 agent 原名，不猜服务协议。
 * 条目形态对齐 desktop agents 清单：role_zh 存于 meta.role_zh，role 为内部角色名兜底。
 */
export const AGENTS_ROLE_SOURCE: Array<{ name: string; role?: string; meta?: { role_zh?: string } }> = []

// ── 呈现表：32 种节点类型全量键控（漏类型编译报错，§4.2）────────────────────
//
// content / group 不走统一名片（各自专用视图直渲），表内条目仅为类型完备占位：
// content 的 executing 文案除外——它是树尾 pending 行的措辞来源（§3.4）。

const PRESENTATIONS: PresentationTable = {
  // 族 1：执行内容
  content: { icon: 'lucide:file-text', verb: '', executing: CONTENT_EXECUTING_LABEL, object: () => '', badges: () => [] },
  thinking: {
    icon: 'lucide:lightbulb',
    verb: '思考',
    executing: THINKING_EXECUTING_LABEL,
    object: () => '',
    badges: () => [],
  },
  group: { icon: 'lucide:folder-open', verb: '', executing: '', object: () => '', badges: () => [] },

  // 族 2：实体与协作
  task: {
    icon: 'lucide:ticket',
    verb: '',
    executing: n => n.activeForm || '正在更新任务',
    object: n => singleLine(n.subject, 80),
    badges: n => [taskStatusLabel(n.taskStatus)].filter(Boolean),
  },
  team: {
    icon: 'lucide:user',
    verb: '已创建团队',
    executing: '正在创建团队',
    object: n => n.teamName,
    badges: n => (n.members.length ? [`${n.members.length} 名成员`] : []),
  },
  subagent: {
    icon: 'lucide:bot',
    verb: '执行任务',
    executing: '正在执行任务',
    // 对象显示 Agent 角色（role_zh），原名兜底——界面暴露角色而非内部名
    object: n => joinObj(agentRoleOf(n.agentName, AGENTS_ROLE_SOURCE), singleLine(n.taskDigest, 60)),
    // 失败态由状态色表达，不叠文字徽标；restored 是全树唯一位置失真特例，必须标注（§2.2）
    badges: n => (n.restored ? ['已恢复'] : []),
  },
  collect: {
    icon: 'lucide:box',
    verb: '已收集',
    executing: '正在收集结果',
    object: n => `${n.sessionIds.length} 个子任务结果`,
    badges: () => [],
  },

  // 族 3：阻塞与系统
  permission: {
    icon: 'lucide:lock',
    verb: n => (n.decision === 'denied' ? '已拒绝' : n.decision === 'pending' ? '等待授权' : '已授权'),
    executing: '等待授权',
    object: n => joinObj(n.toolName, singleLine(n.paramsDigest, 60)),
    badges: n => [n.securityLevel].filter(Boolean),
  },
  ask_user: {
    icon: 'lucide:message-circle',
    verb: n => (n.answers.length ? '已回答' : '向你提问'),
    executing: '等待你的回答',
    object: n =>
      n.answers.length
        ? singleLine(n.answers.map(a => a.answer).filter(Boolean).join('、'), 60)
        : singleLine(n.questions[0]?.question || '', 60),
    badges: n => (n.questions.length > 1 ? [`${n.questions.length} 个问题`] : []),
  },
  error: {
    icon: 'lucide:circle-x',
    verb: '执行出错',
    executing: '',
    object: n => singleLine(n.message, 120),
    badges: n => (n.source === 'llm_timeout' ? ['请求超时'] : n.source === 'provider_402' ? ['服务商欠费'] : []),
  },
  compaction: {
    icon: 'lucide:arrow-down-up',
    verb: '上下文已压缩',
    executing: '',
    object: n => `滑动 ${n.messagesSlid} 条消息`,
    badges: n => (n.remainingAfter ? [`${formatCompactNumber(n.remainingAfter)} tokens`] : []),
    attention: true,
  },
  max_turns: {
    icon: 'lucide:triangle-alert',
    verb: '已达最大轮数',
    executing: '',
    object: n => `${n.turnsCompleted}/${n.maxTurns} 轮`,
    badges: n => (n.suggestion ? [singleLine(n.suggestion, 40)] : []),
    attention: true,
  },
  llm_retry: {
    icon: 'lucide:rotate-cw',
    verb: '请求重试',
    executing: '正在重试',
    object: n => joinObj(n.provider, n.model),
    badges: n =>
      [
        `${n.attempt}/${n.maxAttempts}`,
        n.statusCode ? `HTTP ${n.statusCode}` : '',
        n.retryAfterMs ? `${formatDuration(n.retryAfterMs)} 后重试` : '',
      ].filter(Boolean),
    attention: true,
  },
  cancelled: {
    icon: 'lucide:circle-off',
    verb: '已中断',
    executing: '',
    object: () => '',
    badges: n => (n.elapsedMs ? [formatDuration(n.elapsedMs)] : []),
  },

  // 族 4：工具（18 种，逐条对照 PR 工具对照表的显示名与图标）
  'tool.read': {
    icon: 'lucide:file-text',
    verb: '已读取',
    executing: '正在读取',
    object: n => joinObj(basename(n.path) || n.path, n.lines ? `${n.lines} 行` : ''),
    badges: n => (n.format && n.format !== 'text' ? [n.format === 'image' ? '图片' : '文档'] : []),
    summarize: c => `已读取 ${c} 个文件`,
  },
  'tool.write': {
    icon: 'lucide:file-plus',
    verb: '已创建',
    executing: '正在写入',
    // 宾语走计数形态（参考样式）：文件名与增删明细收进展开态文件行
    object: () => '1 个文件',
    badges: () => [],
    summarize: c => `已创建 ${c} 个文件`,
  },
  'tool.edit': {
    icon: 'lucide:file-pen',
    verb: '已编辑',
    executing: '正在编辑',
    // 宾语走计数形态（参考样式）：文件名与增删明细收进展开态文件行
    object: () => '1 个文件',
    badges: () => [],
    summarize: c => `已编辑 ${c} 个文件`,
  },
  'tool.ls': {
    icon: 'lucide:folder-open',
    verb: '已列出',
    executing: '正在浏览目录',
    object: n => basename(n.path) || n.path,
    badges: n => [n.entryCount != null ? `${n.entryCount} 项` : '', n.recursive ? '递归' : ''].filter(Boolean),
    summarize: c => `已列出 ${c} 个目录`,
  },
  'tool.glob': {
    icon: 'lucide:files',
    verb: '已匹配',
    executing: '正在匹配',
    object: n => singleLine(n.pattern, 60),
    badges: n => [n.matchCount != null ? `${n.matchCount} 个` : ''],
    summarize: c => `已匹配 ${c} 个模式`,
  },
  'tool.grep': {
    icon: 'lucide:search',
    verb: '已搜索',
    executing: '正在搜索',
    object: n => joinObj(singleLine(n.pattern, 60), n.include),
    badges: n => [n.hitCount != null ? `${n.hitCount} 处` : ''],
    summarize: c => `已搜索 ${c} 次`,
  },
  'tool.bash': {
    icon: 'lucide:square-terminal',
    verb: '命令已执行',
    executing: '正在执行命令',
    // 宾语 = 命令单行摘要（参考形态：「命令已执行 cd /Users/ray/wor...」），
    // 完整命令与输出收进展开态终端容器
    object: n => singleLine(n.command, 48),
    badges: () => [],
    summarize: c => `已执行 ${c} 条命令`,
  },
  'tool.run_script': {
    icon: 'lucide:play',
    verb: '已运行脚本',
    executing: '正在运行脚本',
    object: n => n.skillName,
    badges: n => (n.exitCode != null && n.exitCode !== 0 ? [`exit ${n.exitCode}`] : []),
    summarize: c => `已运行 ${c} 个脚本`,
  },
  'tool.web_fetch': {
    icon: 'lucide:link',
    verb: '已抓取',
    executing: '正在阅读网页',
    object: n => n.title || hostOf(n.url),
    badges: n => (n.bytes ? [formatCompactNumber(n.bytes)] : []),
    summarize: c => `已抓取 ${c} 个页面`,
  },
  'tool.web_search': {
    icon: 'lucide:globe',
    verb: '已联网搜索',
    executing: '正在联网搜索',
    object: n => singleLine(n.query, 60),
    badges: n => [n.resultCount != null ? `${n.resultCount} 条` : '', n.cached ? '缓存' : ''].filter(Boolean),
    summarize: c => `已联网搜索 ${c} 次`,
  },
  'tool.kb_search': {
    icon: 'lucide:library',
    verb: '知识库检索',
    executing: '正在检索知识库',
    object: n => singleLine(n.query, 60),
    badges: n => [n.hitCount != null ? `${n.hitCount} 块` : ''],
    summarize: c => `知识库检索 ${c} 次`,
  },
  'tool.memory_search': {
    icon: 'lucide:cpu',
    verb: '记忆检索',
    executing: '正在检索记忆',
    object: n => singleLine(n.query, 60),
    badges: n => [n.hitCount != null ? `${n.hitCount} 条` : ''],
    summarize: c => `记忆检索 ${c} 次`,
  },
  'tool.skill': {
    icon: 'lucide:sparkles',
    verb: '已加载技能',
    executing: '正在加载技能',
    object: n => n.skillName,
    badges: () => [],
    // 关键动作不聚合（groupKey=null），无组头模板
  },
  'tool.sleep': {
    icon: 'lucide:timer',
    verb: '等待',
    executing: '正在等待',
    object: n => (n.durationMs ? formatDuration(n.durationMs) : ''),
    badges: () => [],
    summarize: c => `已等待 ${c} 次`,
  },
  'tool.task_query': {
    icon: 'lucide:ticket',
    verb: '已查询任务',
    executing: '正在查询任务',
    object: n => singleLine(n.resultDigest || '', 60),
    badges: () => [],
    summarize: c => `已查询任务 ${c} 次`,
  },
  'tool.team_ops': {
    icon: 'lucide:user',
    verb: '团队操作',
    executing: '正在查询团队',
    object: n => joinObj(TEAM_ACTION_LABELS[n.action] || n.action, n.teamName, singleLine(n.resultDigest || '', 40)),
    badges: () => [],
    summarize: c => `已查询团队 ${c} 次`,
  },
  'tool.cron': {
    icon: 'lucide:alarm-clock',
    verb: '定时任务',
    executing: '正在编排定时任务',
    object: n => joinObj(n.action, n.cronId, n.agent, n.cronExpr),
    badges: n => (n.enabled === false ? ['已停用'] : []),
    summarize: c => `已操作定时任务 ${c} 次`,
  },
  'tool.notify': {
    icon: 'lucide:bell',
    verb: '已发送通知',
    executing: '正在发送通知',
    object: n => singleLine(n.title, 60),
    badges: () => [],
    summarize: c => `已发送 ${c} 条通知`,
  },
}

// ── 出口：树壳只经这两个函数消费类型差异，不 import 任何具体节点视图 ─────────

/**
 * 名片呈现查询。content / group 返回 null——两者不走统一名片
 * （content 行内 markdown、group 组头走 groupHeaderOf）。
 */
export function presentationOf(node: TreeNode): NodePresentation | null {
  // 贡献层优先（五期槽位）：槽位呈现契约与 NodePresentation 结构同形（名片四要素），
  // 节点形参收窄为贡献节点，出口统一放宽断言一次（对齐内建表出口的逆变放宽先例）
  const slot = slotPresentationOf(node.type)
  if (slot) return slot as unknown as NodePresentation
  if (node.type === 'content' || node.type === 'group') return null
  // 未登记类型（贡献节点等）：内建表无条目，返回 null（树壳按无名片处理）
  return (PRESENTATIONS[node.type] as NodePresentation | undefined) ?? null
}

/** 文案求值：静态文案或按节点数据推导 */
export function resolveText(text: string | ((node: TreeNode) => string), node: TreeNode): string {
  return typeof text === 'function' ? text(node) : text
}

/** 组头兜底模板（§2.3：混合成员类型时按 groupKey 措辞，零特判） */
const GROUP_FALLBACK: Record<GroupKey, (count: number) => string> = {
  'fs.read': c => `已读取 ${c} 个文件`,
  'fs.write': c => `已变更 ${c} 个文件`,
  'fs.browse': c => `已浏览 ${c} 项`,
  'fs.search': c => `已搜索 ${c} 次`,
  cmd: c => `已执行 ${c} 条命令`,
  'web.fetch': c => `已抓取 ${c} 个页面`,
  'web.search': c => `已联网搜索 ${c} 次`,
  'kb.search': c => `已检索 ${c} 次`,
  'task.query': c => `已查询任务 ${c} 次`,
  'team.query': c => `已查询团队 ${c} 次`,
  sys: c => `已执行 ${c} 项系统操作`,
}

/** group 组头：图标与文案由成员推导（单成员类型 → 该类型模板；混合 → groupKey 兜底） */
export function groupHeaderOf(node: GroupNode): { icon: string; text: string } {
  const first = node.children[0]!
  const lead = PRESENTATIONS[first.type] as NodePresentation<ToolNode>
  const types = new Set(node.children.map(c => c.type))
  const text =
    types.size === 1 && lead.summarize
      ? lead.summarize(node.children.length)
      : GROUP_FALLBACK[node.groupKey](node.children.length)
  return { icon: lead.icon, text }
}
