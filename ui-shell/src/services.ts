/** 服务上下文实现：插件间唯一共享通道（契约第 5 节） */

import type { ServiceContext } from './types'

export function createServiceContext(): ServiceContext {
  const impls = new Map<string, unknown>()
  return {
    provide(name, impl) {
      if (!name) {
        throw new Error('服务名不能为空')
      }
      if (impls.has(name)) {
        throw new Error(`服务重复提供：${name}`)
      }
      impls.set(name, impl)
    },
    use<T>(name: string): T {
      const impl = impls.get(name)
      if (impl === undefined) {
        throw new Error(`服务缺失：${name}（依赖缺失应在启动期暴露）`)
      }
      return impl as T
    },
  }
}
