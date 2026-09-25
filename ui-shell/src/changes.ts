/** 结构变更中枢：可变结构 + 版本订阅，由适配器映射为渲染层响应式 */

export interface ChangeHub {
  /** 版本号，任何视图区条目 / 壳状态变更后递增 */
  readonly version: number
  bump(): void
  /** 订阅结构变更，返回取消订阅函数 */
  subscribe(listener: () => void): Unsubscribe
}

import type { Unsubscribe } from './types'

export function createChangeHub(): ChangeHub {
  let version = 0
  const listeners = new Set<() => void>()
  return {
    get version() {
      return version
    },
    bump() {
      version += 1
      // 先复制订阅者再投递，避免投递过程中的增删干扰本轮遍历
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
