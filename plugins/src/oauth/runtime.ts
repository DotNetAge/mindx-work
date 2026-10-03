/**
 * oauth.* RPC 封装与视图类型（daemon 侧 handler_oauth.go 形状对齐）。
 * 消费侧本地声明最小形状——插件间禁止 import，daemon 契约以此为准。
 */

/** 提供商列表条目（oauth.provider.list 响应形状） */
export interface OAuthProviderView {
  name: string
  title: string
  kind: string
  interaction: string
  client_id: string
  configured: boolean
  scopes?: string[]
}

/** daemon.connection.call 的最小形状（消费侧本地声明） */
type CallFn = <T>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>

/** 拉取全部提供商与配置态 */
export async function fetchProviders(call: CallFn): Promise<OAuthProviderView[]> {
  const res = await call<{ providers?: OAuthProviderView[] }>('oauth.provider.list', {}, 10_000)
  return res.providers ?? []
}

/** 第二层模板 client_id 填入（写凭据库；client_secret 仅机密客户端需要） */
export async function configureProvider(call: CallFn, name: string, clientId: string, clientSecret: string): Promise<void> {
  await call('oauth.provider.configure', { name, client_id: clientId, client_secret: clientSecret }, 10_000)
}

/** 启动授权流程（异步：流程事件经 oauth.present_* / oauth.flow_* 通知推送） */
export async function startAuthorize(call: CallFn, name: string): Promise<void> {
  await call('oauth.authorize.start', { name }, 10_000)
}

/** 取消进行中的授权流程 */
export async function cancelAuthorize(call: CallFn, name: string): Promise<void> {
  await call('oauth.authorize.cancel', { name }, 10_000)
}
