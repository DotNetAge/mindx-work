/**
 * 画布撤销/重做：JSON 快照双向栈（cap 50）。
 * snapshot = 清 redo 栈 + push 当前；undo/redo 对称互换；
 * cancelLastSnapshot 只弹 undo 栈不进 redo（零尺寸误触/零位移回滚用）。
 * 栈长用 ref 维护（canUndo/canRedo 响应式驱动按钮禁用态）。
 */
import { ref } from 'vue'
import type { Ref } from 'vue'
import type { BoardShape } from './types'

export function createShapeHistory(shapes: Ref<BoardShape[]>, cap = 50) {
  const undoStack: string[] = []
  const redoStack: string[] = []
  /** 响应式栈长（模板禁用态绑定） */
  const undoLen = ref(0)
  const redoLen = ref(0)

  function snapshot(): void {
    redoStack.length = 0
    redoLen.value = 0
    undoStack.push(JSON.stringify(shapes.value))
    if (undoStack.length > cap) undoStack.shift()
    undoLen.value = undoStack.length
  }

  /** 回滚最近一次快照（本次操作未产生实际变化时用，不进 redo） */
  function cancelLastSnapshot(): void {
    undoStack.pop()
    undoLen.value = undoStack.length
  }

  function undo(): void {
    const prev = undoStack.pop()
    if (!prev) return
    redoStack.push(JSON.stringify(shapes.value))
    shapes.value = JSON.parse(prev) as BoardShape[]
    undoLen.value = undoStack.length
    redoLen.value = redoStack.length
  }

  function redo(): void {
    const next = redoStack.pop()
    if (!next) return
    undoStack.push(JSON.stringify(shapes.value))
    shapes.value = JSON.parse(next) as BoardShape[]
    undoLen.value = undoStack.length
    redoLen.value = redoStack.length
  }

  function canUndo(): boolean {
    return undoLen.value > 0
  }

  function canRedo(): boolean {
    return redoLen.value > 0
  }

  function clear(): void {
    undoStack.length = 0
    redoStack.length = 0
    undoLen.value = 0
    redoLen.value = 0
  }

  return { snapshot, cancelLastSnapshot, undo, redo, canUndo, canRedo, clear }
}
