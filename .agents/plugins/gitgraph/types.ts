/**
 * gitgraph 数据模型：与渲染解耦。数据层（engine/gitSource）产出 GitCommit，
 * 布局层（engine/graphLayout）产出 GraphLayout，渲染层（GitGraphPanel）只
 * 消费派生结果，不感知解析细节。
 */

/** refs 装饰（git log %D 解析产物） */
export interface GitRef {
  kind: 'head' | 'local' | 'remote' | 'tag'
  name: string
}

/** 提交记录（log 单条记录解析产物） */
export interface GitCommit {
  /** 完整 40 位 hash */
  hash: string
  /** 短 hash（仓库生成，7 位以上） */
  short: string
  /** 作者名 */
  author: string
  /** 作者邮箱 */
  email: string
  /** 作者时间（unix 秒） */
  time: number
  /** 单行主题 */
  subject: string
  /** 正文（可为空串） */
  body: string
  /** 该提交携带的分支 / tag 装饰 */
  refs: GitRef[]
  /** 父提交完整 hash（根提交为空数组） */
  parents: string[]
}

/** 渲染行：提交 + 拓扑 lane（lane 0 即 first-parent 主干起点） */
export interface GraphRow {
  commit: GitCommit
  lane: number
}

/** 拓扑边：from 子提交行 → to 父提交行（仅 merge 的非第一父产生显式边） */
export interface GraphEdge {
  fromHash: string
  toHash: string
  laneFrom: number
  laneTo: number
}

/** 布局结果（layoutGraph 纯函数产物） */
export interface GraphLayout {
  rows: GraphRow[]
  edges: GraphEdge[]
  /** 实际使用过的 lane 总数（>= 1） */
  laneCount: number
  /** hash → 行下标（渲染层连线分段 / 父提交定位共用） */
  indexByHash: Map<string, number>
}

/** 提交内文件条目（diff-tree/show --name-status 解析产物） */
export interface FileEntry {
  /** 变更后路径（仓库相对路径，posix 分隔） */
  path: string
  /** status 首字母：A 新增 / M 修改 / D 删除 / R 重命名 / C 复制 */
  status: 'A' | 'M' | 'D' | 'R' | 'C'
  /** R/C 的变更前路径（其余条目为 undefined） */
  oldPath?: string
}

/** 单文件 diff 文本（fetchFileDiff 产物；截断保护由数据层负责） */
export interface FileDiff {
  /** unified diff 文本（可能被截断） */
  text: string
  /** true = 超过大小上限被截断（UI 提示「文件过大，仅显示部分」） */
  truncated: boolean
}
