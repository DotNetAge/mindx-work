// registry/actions.ts —— 节点操作注册表（§4.1：type → actions[]，操作是可审计性的入口）。
//
// 设计依据：PR-REFACTOR-CONVERSATION-TREE.md §4.1 / §4.2：
// - 本表只做「声明」（id / 标签 / 数据可用性），id → 处理器的执行分派在树壳
//   useNodeActions（视图层关注点：剪贴板、编辑器命令等）——registry 保持薄表；
// - 每条目泛型收窄到具体节点类型，when() 里的 payload 字段拼写错误编译期暴露；
// - 表按全量 TreeNodeType 键控，漏类型编译报错（§4.2 穷尽性）；
// - 逐条目操作（grep/glob/web_search 的命中行点击）属展开列表行内行为，由对应节点视图
//   直接调用共享工具函数处理，不在卡片级注册表声明。
//
// 新增一个工具的操作成本 = 在本表对应类型下加一组声明 + 分派器补一个 id 分支。
//
// 移植适配（mindx-work）：icon 由 Vue 组件改为 Iconify 名称字符串（界面军规 9），
// 映射见移植计划附录 B。

import type { TreeNode, TreeNodeType } from '../types'
import { slotActionsOf } from '../../slot/registry'

/** 操作标识：分派器按此路由到具体处理器 */
export type NodeActionId =
  | 'open-file-at'     // 打开文件并定位（read 定位行 / write·edit 定位）
  | 'open-diff'        // 打开 diff（write / edit）
  | 'rollback'         // 回滚（write / edit）
  | 'reveal'           // 在资源管理器中显示（ls）
  | 'copy'             // 复制文本（content / thinking）
  | 'copy-command'     // 复制命令（bash / run_script）
  | 'rerun'            // 重跑命令（bash）
  | 'open-url'         // 打开链接（web_fetch）
  | 'open-skill-doc'   // 查看 SKILL.md（skill）
  | 'open-script-dir'  // 打开 SKILL 目录（run_script）
  | 'open-subsession'  // 打开子会话（subagent / collect）
  | 'open-tasks'       // 打开 Tasks 视图（task / task_query）
  | 'open-schedule'    // 打开 ScheduleView（cron）
  | 'details'          // 查看授权详情（permission）
  | 'view-qa'          // 查看问答详情（ask_user）
  | 'retry'            // 重试（error，阻断节点）
  | 'ignore'           // 忽略（error）
  | 'open-settings'    // 打开设置（error）
  | 'speak'            // 朗读（content 答案形态，平移自 ResultView）
  | 'download-md'      // 下载为 Markdown（content 答案形态）
  | 'save-project'     // 保存到项目（content 答案形态）

/** NodeActionId 运行时全集（与上方联合同步维护；槽位校验层消费——扩展操作 id 仅限既有枚举） */
export const NODE_ACTION_IDS: readonly NodeActionId[] = [
  'open-file-at', 'open-diff', 'rollback', 'reveal', 'copy', 'copy-command', 'rerun',
  'open-url', 'open-skill-doc', 'open-script-dir', 'open-subsession', 'open-tasks',
  'open-schedule', 'details', 'view-qa', 'retry', 'ignore', 'open-settings',
  'speak', 'download-md', 'save-project',
]

export interface NodeAction<N extends TreeNode = TreeNode> {
  id: NodeActionId
  label: string
  /** 图标：Iconify 名称（lucide 集合），消费方 <MxIcon :name> 渲染 */
  icon?: string
  /** 数据可用性：payload 缺数据时隐藏（缺省 = 恒可用） */
  when?: (node: N) => boolean
  /** 内联操作：常驻渲染于宾语之后（如复制命令紧跟命令摘要），不进行尾 hover 操作组 */
  inline?: boolean
}

/** 按判别字段取联合成员类型（判别联合不能直接以 TreeNode[K] 索引取成员） */
type NodeOfType<T extends TreeNodeType> = Extract<TreeNode, { type: T }>

type ActionTable = { [K in TreeNodeType]: NodeAction<NodeOfType<K>>[] }

const ACTION_TABLE: ActionTable = {
  // 族 1：执行内容
  content: [
    // 答案形态（finishReason=stop）操作组平移自 ResultView 工具栏（icon-only，照抄旧版形态）；
    // 「查看原文」切换冗余已删（答案即渲染态，无独立原文价值）。
    // copy 同样仅答案形态：中间叙述段落的裸复制图标是常驻视觉噪音（同 thinking
    // 「复制」裸按钮冗余已删的既定方向），叙述回看靠树展开态本身
    { id: 'copy', label: '复制', icon: 'lucide:copy', when: n => n.finishReason === 'stop' },
    { id: 'speak', label: '朗读', icon: 'lucide:volume-2', when: n => n.finishReason === 'stop' },
    { id: 'download-md', label: '下载为 Markdown', icon: 'lucide:download', when: n => n.finishReason === 'stop' },
    { id: 'save-project', label: '保存到项目', icon: 'lucide:link', when: n => n.finishReason === 'stop' },
  ],
  // thinking：无操作（「复制」裸文字按钮冗余已删）
  thinking: [],
  group: [],
  // 族 2：实体与协作
  task: [{ id: 'open-tasks', label: '打开 Tasks 视图', icon: 'lucide:list' }],
  team: [],
  // subagent：打开子会话按钮内联于行头（SubagentNodeView 自渲染，外部链接图标），
  // 不走本表 —— 避免 NodeCard 在视图下方再渲染一条悬浮操作行
  subagent: [],
  collect: [{ id: 'open-subsession', label: '打开子会话', icon: 'lucide:arrow-up-right', when: n => n.sessionIds.length > 0 }],
  // 族 3：阻塞与系统
  permission: [{ id: 'details', label: '查看详情', icon: 'lucide:info' }],
  ask_user: [{ id: 'view-qa', label: '查看问答', icon: 'lucide:message-circle' }],
  error: [
    { id: 'retry', label: '重试', icon: 'lucide:rotate-cw' },
    { id: 'ignore', label: '忽略', icon: 'lucide:x' },
    { id: 'open-settings', label: '打开设置', icon: 'lucide:settings' },
  ],
  compaction: [],
  max_turns: [],
  llm_retry: [],
  cancelled: [],
  // 族 4：工具（逐条对照 PR 目录表「操作」列）
  // 「打开文件」裸文字按钮冗余已删，tool.read 无操作（文件路径展开态可见）
  'tool.read': [],
  // write/edit（参考形态）：名片行与文件行零按钮；diff 回看由文件行点击触发（open-diff 上抛）
  'tool.write': [],
  'tool.edit': [],
  'tool.ls': [{ id: 'reveal', label: '在资源管理器中显示', icon: 'lucide:folder-open' }],
  'tool.glob': [],
  'tool.grep': [],
  'tool.bash': [
    { id: 'copy-command', label: '复制命令', icon: 'lucide:copy', when: n => !!n.command, inline: true },
    { id: 'rerun', label: '重跑', icon: 'lucide:refresh-cw' },
  ],
  'tool.run_script': [
    { id: 'copy-command', label: '复制脚本命令', icon: 'lucide:copy', when: n => !!n.script },
    { id: 'open-script-dir', label: '打开 SKILL 目录', icon: 'lucide:folder-open', when: n => !!n.skillName },
  ],
  'tool.web_fetch': [{ id: 'open-url', label: '打开链接', icon: 'lucide:arrow-up-right', when: n => !!n.url }],
  'tool.web_search': [],
  'tool.kb_search': [],
  'tool.memory_search': [],
  'tool.skill': [{ id: 'open-skill-doc', label: '查看 SKILL.md', icon: 'lucide:file-text', when: n => !!n.rootDir }],
  'tool.sleep': [],
  'tool.task_query': [{ id: 'open-tasks', label: '打开 Tasks 视图', icon: 'lucide:list' }],
  'tool.team_ops': [],
  'tool.cron': [{ id: 'open-schedule', label: '打开定时任务', icon: 'lucide:alarm-clock' }],
  'tool.notify': [],
}

/** 内建保留键全集：ACTION_TABLE 全量键控的运行时投影（32 型含 null 键；槽位校验层消费） */
export const BUILTIN_NODE_TYPE_KEYS: readonly string[] = Object.keys(ACTION_TABLE)

/**
 * 节点操作声明查询（含 when 过滤的可用动作）。
 * 查找链 = 贡献层优先、内建层兜底（五期槽位）：槽位登记的类型返回贡献声明
 * （ChatFlowSlotAction 与 NodeAction 结构同形，id 已在注册期限定枚举；出口放宽断言一次）。
 * 泛型表按具体节点类型收窄 when 参数，跨类型出口处统一放宽（逆变，需断言一次）。
 */
export function actionsOf(node: TreeNode): NodeAction[] {
  const slot = slotActionsOf(node.type)
  if (slot) return slot as unknown as NodeAction[]
  const all = (ACTION_TABLE[node.type] as NodeAction[] | undefined) ?? []
  return all.filter(a => !a.when || a.when(node))
}
