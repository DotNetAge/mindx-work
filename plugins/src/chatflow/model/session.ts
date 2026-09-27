// Session 类型投影（源：mindx-desktop stores/sessionStore.ts，字段逐一核对）。
//
// 会话数据根容器：Tasks 列表与消息流加载的唯一入口。
// Tab 模型不搬（壳 Content 单活动视图替代）；title 的写入能力随四期 Daemon 配合项。

export interface Session {
  session_id: string
  agent_name?: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
  project_dir?: string
  /** 会话在 daemon 侧的目录（图片等会话临时文件落盘位置） */
  session_dir?: string
}
