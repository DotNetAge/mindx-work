// useActivePath —— 活跃路径集合（PR §3.1 / subagent 特殊机制第 5 条）。
//
// 「执行中只自动展开根 → 当前活跃节点路径，其余折叠」：活跃路径是集合不是单链
// （并行 subagent 各自独立活跃）。一阶段 subagent 全卡无子树，集合元素 =
// ① status === 'executing' 的节点（主会话任意时刻至多一个）；
// ② 执行中 group 的成员 executing 时，group 本身（祖先链，树深 ≤2 仅一层）。
// 折叠 UI 态覆盖 Map 优先级高于活跃路径（用户手动收起不被自动展开顶回）。

import { computed, type Ref } from 'vue'
import type { TreeNode } from '../types'
import { isGroupNode } from '../types'

export function useActivePath(nodes: Ref<TreeNode[]>) {
  const activeIds = computed<Set<string>>(() => {
    const set = new Set<string>()
    for (const node of nodes.value) {
      if (node.status === 'executing') set.add(node.id)
      // 活跃成员的祖先链：group → 活跃 child
      if (isGroupNode(node)) {
        for (const child of node.children) {
          if (child.status === 'executing') set.add(node.id)
        }
      }
    }
    return set
  })

  return { activeIds }
}
