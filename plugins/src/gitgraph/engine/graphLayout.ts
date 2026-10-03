/**
 * 拓扑布局纯函数（零依赖、零 IO）：输入提交列表（git log 时间倒序，含父
 * hash），输出每行 lane 与连线边段。lane 分配策略：首个提交占 lane 0
 * （first-parent 主干沿 lane 0 直下）；merge 的非第一父作为分支引用开新
 * lane，优先复用已结束（空闲）的 lane 槽；merge 子 lane 经贝塞尔曲线并入
 * 目标 lane。分页追加不回改历史行：期待中的父引用槽位在分配时即保留，新页
 * 提交落位后连线自然补全（布局全量重算结果与增量一致，算法为确定性顺序处理）。
 */

import type { GitCommit, GraphEdge, GraphLayout, GraphRow } from '../types'

/** 行高（px）：graph SVG 与提交行共用同一常量 */
export const ROW_H = 52

/** lane 横向间距（px） */
export const LANE_GAP = 13

/** lane 中心 x 坐标 */
export function laneX(lane: number): number {
  return 12 + lane * LANE_GAP
}

/**
 * lane 色板（8 色循环）：全部取主题语义 token，亮暗主题自适应，无字面色值
 * （mx-uikit token 表内核对存在；分支专用色 token 体系未提供，按约束用既有
 * 功能色 + 墨色补足循环区分度）。
 */
export const LANE_COLORS = [
  'var(--mx-accent)',
  'var(--mx-business)',
  'var(--mx-state-success)',
  'var(--mx-state-warn)',
  'var(--mx-state-error)',
  'var(--mx-state-idle)',
  'var(--mx-text-secondary)',
  'var(--mx-text-tertiary)',
]

/** lane → 色值（循环取色板） */
export function laneColor(lane: number): string {
  const index = ((lane % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length
  return LANE_COLORS[index] ?? 'var(--mx-accent)'
}

/** 单行内的一段连线（d 为 SVG path，lane 供 hover 同 lane 提亮归类） */
export interface RowSeg {
  d: string
  lane: number
}

/** 拓扑布局主函数：逐提交分配 lane 并收集 merge 边 */
export function layoutGraph(commits: GitCommit[]): GraphLayout {
  // 每 lane 当前期待的父 hash（null = 该 lane 已结束，可复用）
  const slots: Array<string | null> = []
  const rows: GraphRow[] = []
  const edges: GraphEdge[] = []
  const indexByHash = new Map<string, number>()

  const firstIdleSlot = (): number => {
    const idle = slots.indexOf(null)
    return idle === -1 ? slots.length : idle
  }

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]
    if (!commit) continue
    let lane = slots.indexOf(commit.hash)
    if (lane === -1) {
      // 新出现的引用（页尾截断后的父、--all 下其它分支 tip）：开新 lane 或复用空槽
      lane = firstIdleSlot()
      slots[lane] = null
    }
    indexByHash.set(commit.hash, i)
    rows.push({ commit, lane })
    const firstParent = commit.parents[0]
    if (!firstParent) {
      // 根提交：lane 释放
      slots[lane] = null
      continue
    }
    // 第一父继承本 lane（主干直下）；边数据同步产出——渲染层按边派生线段，
    // 漏掉第一父边会导致主干（非 merge 场景）完全没有连线、只剩孤立节点
    slots[lane] = firstParent
    edges.push({ fromHash: commit.hash, toHash: firstParent, laneFrom: lane, laneTo: lane })
    // 非第一父：已占用则合流（curve 并入既有 lane），否则开新 lane
    for (const parent of commit.parents.slice(1)) {
      let parentLane = slots.indexOf(parent)
      if (parentLane === -1) {
        parentLane = firstIdleSlot()
        slots[parentLane] = parent
      }
      edges.push({ fromHash: commit.hash, toHash: parent, laneFrom: lane, laneTo: parentLane })
    }
  }

  const laneCount = rows.reduce((max, row) => Math.max(max, row.lane + 1), 1)
  return { rows, edges, laneCount, indexByHash }
}

/**
 * 按行派生连线段：每条边拆为「子行内转弯段 + 中间行竖线 + 父行入点段」，
 * 全部落进各自行的小 SVG（行级增量渲染：滚动追加新行不触碰旧行 DOM）。
 * 行高经 heightOf 按行取值（默认恒 ROW_H）：行内展开详情会把该行撑高，
 * 段坐标随真高延伸（子行段到行底、中间行段贯穿全行），相邻行上段终点 =
 * 下行段起点（角到角拼接），任意行高组合无缝。悬空边（父未在已加载列表，
 * 页尾截断场景）跳过不画。
 */
export function buildRowGraphics(
  layout: GraphLayout,
  heightOf: (hash: string) => number = () => ROW_H,
): Map<string, RowSeg[]> {
  const byHash = new Map<string, RowSeg[]>()
  const push = (hash: string, seg: RowSeg): void => {
    const list = byHash.get(hash)
    if (list) list.push(seg)
    else byHash.set(hash, [seg])
  }
  const cy = ROW_H / 2
  const half = ROW_H / 2
  for (const edge of layout.edges) {
    const fromIndex = layout.indexByHash.get(edge.fromHash)
    const toIndex = layout.indexByHash.get(edge.toHash)
    // 父未加载 / 顺序异常（不应发生）：跳过
    if (fromIndex === undefined || toIndex === undefined || toIndex <= fromIndex) continue
    const xFrom = laneX(edge.laneFrom)
    const xTo = laneX(edge.laneTo)
    if (edge.laneFrom === edge.laneTo) {
      // 同 lane 直下：子行内竖直向下到行底
      push(edge.fromHash, {
        d: `M ${xFrom} ${cy} L ${xFrom} ${heightOf(edge.fromHash)}`,
        lane: edge.laneFrom,
      })
    } else {
      // 并入曲线：贝塞尔在子行内完成横向位移，落点行底
      const h = heightOf(edge.fromHash)
      push(edge.fromHash, {
        d: `M ${xFrom} ${cy} C ${xFrom} ${cy + half} ${xTo} ${h - half} ${xTo} ${h}`,
        lane: edge.laneFrom,
      })
    }
    // 中间行：沿目标 lane 的竖线（贯穿该行全高）
    for (let i = fromIndex + 1; i < toIndex; i++) {
      const midRow = layout.rows[i]
      if (!midRow) continue
      push(midRow.commit.hash, {
        d: `M ${xTo} 0 L ${xTo} ${heightOf(midRow.commit.hash)}`,
        lane: edge.laneTo,
      })
    }
    // 父行：顶缘入到节点
    push(edge.toHash, { d: `M ${xTo} 0 L ${xTo} ${cy}`, lane: edge.laneTo })
  }
  return byHash
}
