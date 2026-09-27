// chatflow-builder.spec.mjs —— tree/builder 行为断言（一期验收件）。
//
// fixture 覆盖移植计划一期口径：单轮含 thinking / 工具 / group 聚合 / subtask /
// permission / error 六类节点的归一，外加三个横切机制：
//   记忆化（历史轮缓存命中复用节点引用）、子会话流内联（工作块 E）、
//   持久化子任务补齐（恢复三路合成之三，restored 标注）。
// 运行：pnpm test（node --test，经 chatflow-loader.mjs 补后缀 + stub vue）。

import { register } from 'node:module'
import assert from 'node:assert/strict'
import { test } from 'node:test'

// 先注册解析钩子再动态 import TS 源码（本文件其余 import 均为 node 内置）
register('./chatflow-loader.mjs', import.meta.url)

const { buildTreesForRounds, clearTreeBuildState } = await import(
  '../plugins/src/chatflow/tree/builder/index.ts'
)

// ── 消息工厂：时间戳逐条递增，保证 startedAt 轮内偏移单调 ────────────────────

let seq = 0
function msg(fields) {
  seq += 1
  return {
    id: `m${seq}`,
    role: 'assistant',
    content: '',
    timestamp: new Date(Date.UTC(2026, 8, 26) + seq * 100).toISOString(),
    sessionId: 's-fix',
    ...fields,
  }
}

/** 一轮六类节点 fixture（归一断言的主输入） */
function buildMainRound(key) {
  return {
    key,
    isFinal: true,
    messages: [
      msg({ role: 'user', content: '帮我整理项目' }),
      msg({ eventType: 'thinking_done', content: '先看结构' }),
      msg({
        eventType: 'tool_exec', eventTitle: 'Read',
        eventData: {
          status: 'success',
          start: { params: { file_path: '/x/a.ts' } },
          end: { result: 'ok', duration_ms: 10, result_meta: { lines_read: 10 } },
        },
      }),
      msg({
        eventType: 'tool_exec', eventTitle: 'Read',
        eventData: {
          status: 'success',
          start: { params: { file_path: '/x/b.ts' } },
          end: { duration_ms: 5, result_meta: { lines_read: 4 } },
        },
      }),
      msg({
        eventType: 'tool_exec', eventTitle: 'Glob',
        eventData: {
          status: 'success',
          start: { params: { pattern: '**/*.ts' } },
          end: { result_meta: { match_count: 3 } },
        },
      }),
      msg({ eventType: 'subtask_spawned', eventData: { session_id: 'sub-1', agent_name: 'explorer', description: '查资料' } }),
      msg({ eventType: 'permission_request', eventData: { tool_name: 'Bash', params: { command: 'rm -rf /tmp/x' }, security_level: 'high' } }),
      msg({
        eventType: 'tool_exec', eventTitle: 'Bash',
        eventData: {
          status: 'success',
          start: { params: { command: 'rm -rf /tmp/x' } },
          end: { duration_ms: 20, result: 'done', result_meta: { exit_code: 0 } },
        },
      }),
      msg({ eventType: 'subtask_completed', eventData: { session_id: 'sub-1', success: true, answer: '资料齐了' } }),
      msg({ eventType: 'error', content: '请求超时', metadata: { http_class: 'timeout' } }),
      msg({
        eventType: 'content_delta', content: '整理完毕',
        tokenUsage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }),
    ],
  }
}

test('单轮归一：六类节点 + group 相邻聚合 + permission 审计闭环 + 残余零残留', () => {
  clearTreeBuildState('s-fix')
  const [tree] = buildTreesForRounds('s-fix', [buildMainRound('round-1')])

  const types = tree.nodes.map(n => n.type)
  assert.deepEqual(types, [
    'thinking', 'group', 'tool.glob', 'subagent', 'permission', 'tool.bash', 'error', 'content',
  ])

  // thinking_done → success 定稿（thinking_delta 则 executing）
  assert.equal(tree.nodes[0].status, 'success')
  assert.equal(tree.nodes[0].content, '先看结构')

  // 相邻同 groupKey（fs.read）聚合成 group：单成员去壳、多成员包组
  const group = tree.nodes[1]
  assert.equal(group.groupKey, 'fs.read')
  assert.equal(group.children.length, 2)
  assert.equal(group.status, 'success')

  // glob 被异类别冲刷出缓冲：单成员去壳落工具节点本体
  assert.equal(tree.nodes[2].pattern, '**/*.ts')
  assert.equal(tree.nodes[2].matchCount, 3)

  // subtask 双事件 upsert 单卡片：spawn 建卡，completed 原位回填完成态
  const sub = tree.nodes[3]
  assert.equal(sub.agentName, 'explorer')
  assert.equal(sub.taskDigest, '查资料')
  assert.equal(sub.status, 'success')
  assert.equal(sub.resultDigest, '资料齐了')

  // permission：pending 节点被同工具名实际执行闭合为 granted（请求 + 决定完整留痕）
  const perm = tree.nodes[4]
  assert.equal(perm.toolName, 'Bash')
  assert.equal(perm.decision, 'granted')
  assert.equal(perm.status, 'success')
  assert.equal(perm.securityLevel, 'high')

  assert.equal(tree.nodes[5].command, 'rm -rf /tmp/x')
  assert.equal(tree.nodes[5].exitCode, 0)

  // error source 归一：http_class=timeout → llm_timeout
  assert.equal(tree.nodes[6].source, 'llm_timeout')
  assert.equal(tree.nodes[6].message, '请求超时')

  // 末条 content + isFinal → 最终答案定稿；消息级 tokenUsage 汇总为 TurnUsage
  assert.equal(tree.nodes[7].finishReason, 'stop')
  assert.equal(tree.nodes[7].turnUsage.promptTokens, 100)
  assert.equal(tree.nodes[7].turnUsage.completionTokens, 20)

  // 全部事件被登记类型消费，审计不丢内容
  assert.deepEqual(tree.residual, [])
})

test('记忆化：历史轮缓存命中复用节点引用，末轮始终重建', () => {
  clearTreeBuildState('s-memo')
  const secondRound = {
    key: 'round-2',
    isFinal: true,
    messages: [
      msg({ role: 'user', content: '继续' }),
      msg({ eventType: 'content_delta', content: '完成' }),
    ],
  }
  const first = buildTreesForRounds('s-memo', [buildMainRound('round-1'), secondRound])
  const second = buildTreesForRounds('s-memo', [buildMainRound('round-1'), secondRound])

  // 历史轮（非末轮、消息数与终结标志未变）命中缓存：节点数组同一引用
  assert.equal(second[0].nodes, first[0].nodes)
  // 末轮每 pass 全量重建（实时流式原地变载）：引用不同而结构等价
  assert.notEqual(second[1].nodes, first[1].nodes)
  assert.deepEqual(second[1].nodes.map(n => n.type), first[1].nodes.map(n => n.type))
})

test('子会话流内联：subagent 节点挂接嵌套 children 并按流长度记忆化', () => {
  clearTreeBuildState('s-stream')
  const round = {
    key: 'round-1',
    isFinal: true,
    messages: [
      msg({ role: 'user', content: 'go' }),
      msg({ eventType: 'subtask_spawned', eventData: { session_id: 'sub-9', agent_name: 'runner', description: '干活' } }),
    ],
  }
  const stream = [
    msg({ eventType: 'thinking_done', content: '子思考' }),
    msg({ eventType: 'content_delta', content: '子答案' }),
  ]
  const [tree] = buildTreesForRounds('s-stream', [round], { subagentStreams: { 'sub-9': stream } })
  const sub = tree.nodes.find(n => n.type === 'subagent')
  assert.ok(sub, 'subagent 节点应在树中')
  assert.equal(sub.children.length, 2)
  assert.equal(sub.children[0].type, 'thinking')

  // 流长度未变：children 从记忆化缓存取引用
  const [tree2] = buildTreesForRounds('s-stream', [round], { subagentStreams: { 'sub-9': stream } })
  assert.equal(tree2.nodes.find(n => n.type === 'subagent').children, sub.children)
})

test('持久化子任务补齐：快照缺失时追加末轮轮尾并标注 restored', () => {
  clearTreeBuildState('s-restore')
  const round = {
    key: 'round-1',
    isFinal: true,
    messages: [
      msg({ role: 'user', content: '早期任务' }),
      msg({ eventType: 'content_delta', content: '好了' }),
    ],
  }
  const persisted = [
    { session_id: 'gone-1', agent_name: 'ghost', description: '滑出窗口的任务', success: true, answer: '早完成了' },
  ]
  const [tree] = buildTreesForRounds('s-restore', [round], { persistedSubtasks: persisted })
  const restored = tree.nodes.find(n => n.type === 'subagent')
  assert.ok(restored, '补齐卡应追加到末轮轮尾')
  assert.equal(restored.restored, true)
  assert.equal(restored.sessionId, 'gone-1')
  assert.equal(restored.status, 'success')
  assert.equal(restored.resultDigest, '早完成了')
})

test('关键动作独立落卡：groupKey=null 工具（Skill）冲刷缓冲后节点本体入树', () => {
  // 缺陷回归（五期勘察探针实证）：原路径经 pushToGroupBuffer 的 null 分支只冲刷旧缓冲，
  // 节点本体无人 push——Skill 等关键动作痕迹整体丢失
  clearTreeBuildState('s-keyaction')
  const [tree] = buildTreesForRounds('s-keyaction', [{
    key: 'round-1',
    isFinal: true,
    messages: [
      msg({ eventType: 'tool_exec', eventTitle: 'Read', eventData: { status: 'success', start: { params: { file_path: '/x/a.ts' } }, end: { duration_ms: 5 } } }),
      msg({ eventType: 'tool_exec', eventTitle: 'Skill', eventData: { status: 'success', start: { params: { name: 'mx-audit' } }, end: { duration_ms: 30, result: 'ok' } } }),
      msg({ eventType: 'final_answer', content: 'done' }),
    ],
  }])

  const types = tree.nodes.map(n => n.type)
  // Skill 前的 Read 单成员缓冲被冲刷去壳落节点，Skill 本体独立落卡（不聚合）
  assert.deepEqual(types, ['tool.read', 'tool.skill', 'content'])
  assert.equal(tree.nodes[1].toolName, 'Skill')
  assert.equal(tree.nodes[1].skillName, 'mx-audit')
})
