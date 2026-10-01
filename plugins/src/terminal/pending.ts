/**
 * terminal 插件内的跨组件共享状态：terminal_run 事件待执行命令。
 * index.ts 订阅 daemon 事件写入，TerminalPanel 挂载/监听消费；同插件模块内
 * 共享（跨插件禁止 import，契约 §10.2），消费后置空防重复执行。
 */
import { ref } from 'vue'

/** 待写入终端的命令（cwd 为 CLI 上报的 Agent 工作区，空串回退当前会话目录） */
export interface PendingTerminalCommand {
  command: string
  cwd: string
}

export const pendingTerminalCommand = ref<PendingTerminalCommand | null>(null)
