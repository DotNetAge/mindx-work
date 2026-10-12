/**
 * oauth.authorize.* RPC 封装（daemon 侧 handler_oauth.go 形状对齐）。
 * 消费侧本地声明最小形状——插件间禁止 import，daemon 契约以此为准。
 */

/** daemon.connection.call 的最小形状（消费侧本地声明） */
type CallFn = <T>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>

/** 启动授权流程（异步：流程事件经 oauth.present_* / oauth.flow_* 通知推送） */
export async function startAuthorize(call: CallFn, name: string): Promise<void> {
  await call('oauth.authorize.start', { name }, 10_000)
}

/** 取消进行中的授权流程 */
export async function cancelAuthorize(call: CallFn, name: string): Promise<void> {
  await call('oauth.authorize.cancel', { name }, 10_000)
}
