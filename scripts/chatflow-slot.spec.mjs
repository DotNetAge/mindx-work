// chatflow-slot.spec.mjs —— 五期槽位机制行为断言（验收件）。
//
// 覆盖移植计划五期口径：
//   注册校验（presentation 必填 / 保留键不可认领 / 冲突抛错 / action id 枚举限定）+
//   查找链（贡献层优先、内建层兜底）+ builder 槽位工具归一（贡献节点独立落卡）+
//   内建行为回归（未登记工具降级残余不私加节点类型）。
// 渲染出口（树壳 <component :is> 分派）由 Playwright ?fixture=slot 真机断言。
// 运行：pnpm test（node --test，经 chatflow-loader.mjs 补后缀 + stub vue）。

import { register } from 'node:module'
import assert from 'node:assert/strict'
import { test } from 'node:test'

// 先注册解析钩子再动态 import TS 源码（本文件其余 import 均为 node 内置）
register('./chatflow-loader.mjs', import.meta.url)

const { chatflowSlotHost } = await import('../plugins/src/chatflow/slot/index.ts')
const {
  slotViewOf, slotPresentationOf, slotActionsOf, slotNodeTypeOfTool, slotHasKey,
} = await import('../plugins/src/chatflow/slot/registry.ts')
const { buildTreesForRounds, clearTreeBuildState } = await import(
  '../plugins/src/chatflow/tree/builder/index.ts'
)
const { actionsOf } = await import('../plugins/src/chatflow/tree/registry/actions.ts')

/** 合法名片四要素（各用例按需覆写） */
function presentation(overrides = {}) {
  return {
    icon: 'lucide:rocket',
    verb: '已部署',
    executing: '部署中',
    object: n => String(n.params.target ?? ''),
    badges: () => [],
    ...overrides,
  }
}

const baseSpec = overrides => ({
  key: 'tool.alpha',
  toolNames: ['Alpha'],
  presentation: presentation(),
  ...overrides,
})

// ── 注册与查找链 ───────────────────────────────────────────────────────────

test('注册成功：三件套落表，贡献层查询出口可见', () => {
  assert.equal(slotHasKey('tool.alpha'), false, '前置：键未登记')
  chatflowSlotHost.register(baseSpec())

  assert.equal(slotHasKey('tool.alpha'), true)
  assert.equal(slotNodeTypeOfTool('Alpha'), 'tool.alpha', '工具名归一到槽位键')
  assert.ok(slotPresentationOf('tool.alpha'), 'presentation 落表')
  assert.ok(slotViewOf('tool.alpha') === null, '未声明 view：视图查询为 null（名片-only 槽位）')
  assert.deepEqual(slotActionsOf('tool.alpha'), [])
})

test('查找链：贡献层优先、内建层兜底（内建类型不受贡献层影响）', () => {
  chatflowSlotHost.register(baseSpec({
    key: 'tool.beta',
    toolNames: ['Beta'],
    presentation: presentation(),
    view: function BetaView() {},
    viewStandalone: true,
    actions: [{ id: 'copy-command', label: '复制命令', icon: 'lucide:copy' }],
  }))

  // 贡献层：view + standalone 语义同内建（SlotViewEntry 形态对齐 NodeViewEntry）
  const view = slotViewOf('tool.beta')
  assert.ok(view, '贡献视图可查')
  assert.equal(view.standalone, true)
  assert.deepEqual(slotActionsOf('tool.beta'), [{ id: 'copy-command', label: '复制命令', icon: 'lucide:copy' }])

  // 内建兜底：未登记键回落内建表（actionsOf 经 ACTION_TABLE；贡献节点不污染内建键）
  const fakeBash = { type: 'tool.bash', command: 'ls' }
  const builtinActions = actionsOf(fakeBash).map(a => a.id)
  assert.deepEqual(builtinActions, ['copy-command', 'rerun'])
})

// ── 校验层：启动期违规抛错 = 装配失败 ──────────────────────────────────────

test('presentation 必填且四要素成形', () => {
  assert.throws(() => chatflowSlotHost.register(baseSpec({ key: 'tool.v1', presentation: undefined })), /presentation 必填/)
  assert.throws(() => chatflowSlotHost.register(baseSpec({ key: 'tool.v2', presentation: presentation({ icon: '' }) })), /icon/)
  assert.throws(() => chatflowSlotHost.register(baseSpec({ key: 'tool.v3', presentation: presentation({ object: 'x' }) })), /object/)
})

test('保留键不可认领：内建 32 型全集（含 null 键）与内建工具对照表', () => {
  // 键形状合法的内建保留键：tool.read / tool.sleep 均为内建 null 键（不可认领）
  assert.throws(() => chatflowSlotHost.register(baseSpec({ key: 'tool.read' })), /保留键/)
  assert.throws(() => chatflowSlotHost.register(baseSpec({ key: 'tool.sleep' })), /保留键/)
  // 工具名与内建对照表冲突（Read 是内建登记工具）
  assert.throws(() => chatflowSlotHost.register(baseSpec({ key: 'tool.v4', toolNames: ['Read'] })), /内建工具对照表/)
})

test('键形状：v1 限工具族 tool.<snake>', () => {
  assert.throws(() => chatflowSlotHost.register(baseSpec({ key: 'deploy' })), /tool\.<snake_case>/)
  assert.throws(() => chatflowSlotHost.register(baseSpec({ key: 'entity.deploy' })), /tool\.<snake_case>/)
})

test('冲突抛错：键重复 / 工具名跨槽位冲突', () => {
  assert.throws(() => chatflowSlotHost.register(baseSpec()), /已被其他槽位注册/)
  assert.throws(() => chatflowSlotHost.register(baseSpec({ key: 'tool.v5', toolNames: ['Alpha'] })), /已被其他槽位认领/)
})

test('action id 仅限既有 NodeActionId 枚举', () => {
  assert.throws(
    () => chatflowSlotHost.register(baseSpec({ key: 'tool.v6', toolNames: [], actions: [{ id: 'export-pdf', label: '导出 PDF' }] })),
    /NodeActionId 枚举/
  )
})

test('viewStandalone 需与 view 同时声明', () => {
  assert.throws(() => chatflowSlotHost.register(baseSpec({ key: 'tool.v7', viewStandalone: true })), /viewStandalone/)
})

// ── builder 归一：槽位认领工具 → 贡献节点 ─────────────────────────────────

let seq = 0
function msg(fields) {
  seq += 1
  return {
    id: `m${seq}`,
    role: 'assistant',
    content: '',
    timestamp: new Date(Date.UTC(2026, 8, 26) + seq * 100).toISOString(),
    sessionId: 's-slot',
    ...fields,
  }
}

test('builder：槽位认领工具归一为贡献节点（type = 槽位键，params 结构化透传）', () => {
  chatflowSlotHost.register(baseSpec({
    key: 'tool.gamma',
    toolNames: ['Gamma'],
    presentation: presentation(),
  }))
  clearTreeBuildState('s-slot')
  const [tree] = buildTreesForRounds('s-slot', [{
    key: 'round-1',
    isFinal: true,
    messages: [
      msg({ role: 'user', content: 'go' }),
      msg({
        eventType: 'tool_exec', eventTitle: 'Gamma',
        eventData: {
          status: 'success',
          start: { params: { target: '预发集群', version: 'v1' } },
          end: { duration_ms: 120, result: 'ok', result_meta: { replicas: 3 } },
        },
      }),
      msg({ eventType: 'final_answer', content: 'done' }),
    ],
  }])

  const node = tree.nodes.find(n => n.type === 'tool.gamma')
  assert.ok(node, '贡献节点应入树（贡献层只服务后端新增的节点类型）')
  assert.equal(node.toolName, 'Gamma')
  assert.deepEqual(node.params, { target: '预发集群', version: 'v1' })
  assert.equal(node.status, 'success')
  assert.equal(node.outputTail, 'ok')
  assert.deepEqual(node.resultMeta, { replicas: 3 })
  assert.deepEqual(tree.residual, [], '槽位认领工具不落残余')
})

test('内建行为回归：未登记且无槽位认领的工具降级残余，不私加节点类型', () => {
  clearTreeBuildState('s-slot')
  const [tree] = buildTreesForRounds('s-slot', [{
    key: 'round-1',
    isFinal: true,
    messages: [
      msg({ role: 'user', content: 'go' }),
      msg({
        eventType: 'tool_exec', eventTitle: 'Mystery',
        eventData: { status: 'success', start: { params: {} }, end: { duration_ms: 10, result: 'ok' } },
      }),
      msg({ eventType: 'final_answer', content: 'done' }),
    ],
  }])
  assert.equal(tree.nodes.find(n => n.type === 'tool.mystery' || n.toolName === 'Mystery'), undefined)
  assert.equal(tree.residual.length, 1, '未登记工具进残余消息（builder 不私加节点类型）')
})
