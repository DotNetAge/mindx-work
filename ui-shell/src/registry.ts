/** 通用条目注册表：id 区内唯一（冲突抛错）、order 排序（缺省 100，小者在前） */

import type { ChangeHub } from './changes'

export interface RegistryApi<E extends { id: string }> {
  /** 已注册条目（按 order 排序后的只读快照） */
  readonly entries: readonly E[]
  add(entry: E): void
  remove(id: string): void
  has(id: string): boolean
}

export function createRegistry<E extends { id: string; order?: number }>(
  hub: ChangeHub,
  regionLabel: string,
): RegistryApi<E> {
  let list: E[] = []
  const index = new Map<string, E>()

  const sortList = () => {
    // Array.prototype.sort 稳定：同 order 保持注册先后
    list.sort((a, b) => orderOf(a) - orderOf(b))
  }

  return {
    get entries() {
      // 只读快照：返回拷贝，外部无法改写内部数组，remove 换引用后旧持有者也不受影响
      return list.slice()
    },
    has: (id) => index.has(id),
    add(entry) {
      if (!entry.id) {
        throw new Error(`${regionLabel}条目缺少 id`)
      }
      if (index.has(entry.id)) {
        throw new Error(`${regionLabel}条目 id 冲突：${entry.id}`)
      }
      list.push(entry)
      index.set(entry.id, entry)
      sortList()
      hub.bump()
    },
    remove(id) {
      if (!index.has(id)) {
        throw new Error(`${regionLabel}不存在条目：${id}`)
      }
      list = list.filter((entry) => entry.id !== id)
      index.delete(id)
      hub.bump()
    },
  }
}

function orderOf(entry: { order?: number }): number {
  return entry.order ?? 100
}
