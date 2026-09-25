/**
 * 设置持久化控制器（契约类型定稿在 ui-shell/src/desktop-bridge.ts，此处为实现）：
 * 内存 Map 缓存 + 宿主桥读写（mxDesktop.preferences，主进程落盘 userData/preferences.json）。
 * 纯 Web 环境（无宿主桥）降级为仅内存——能力可选与桥的纪律一致。
 * 时序：构造即发起读回（ready），读回前 get 返回 fallback、set 仅入内存；
 * 读回后恢复流程由装配层在 ready.then 中执行（避免覆盖落盘值）。
 */
import type { PreferencesController } from '@mindx-work/ui-shell'

export type { PreferencesController } from '@mindx-work/ui-shell'

export function createPreferencesController(): PreferencesController {
  const values = new Map<string, unknown>()
  const listeners = new Map<string, Set<(value: unknown) => void>>()

  // 读回：灌缓存；无桥（纯 Web）或读回失败时立即就绪（按空表启动）
  const bridge = window.mxDesktop?.preferences
  const ready: Promise<void> = bridge
    ? bridge
        .getAll()
        .then((all) => {
          if (!all) return
          for (const [key, value] of Object.entries(all)) values.set(key, value)
        })
        .catch((error) => {
          console.error('设置持久化读回失败，按空设置启动：', error)
        })
    : Promise.resolve()

  return {
    ready,
    get<T>(key: string, fallback: T): T {
      return (values.has(key) ? (values.get(key) as T) : fallback)
    },
    set(key: string, value: unknown): void {
      values.set(key, value)
      // 先复制订阅者列表再投递（快照语义：监听器内退订不影响本轮投递）
      for (const listener of
        // oxlint-disable-next-line unicorn/no-useless-spread —— 防御性复制，非多余转换
        [...(listeners.get(key) ?? [])]) listener(value)
      void bridge?.set(key, value).then((ok) => {
        if (!ok) console.error(`设置落盘失败（键 ${key}）：主进程拒绝写入`)
      })
    },
    subscribe(key: string, listener: (value: unknown) => void): () => void {
      let set = listeners.get(key)
      if (!set) {
        set = new Set()
        listeners.set(key, set)
      }
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    },
  }
}
