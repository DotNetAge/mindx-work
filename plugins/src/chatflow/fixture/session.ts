// fixture —— 验收用静态会话数据（无真实数据层，store 空壳由此供数）。
//
// 四轮消息流覆盖二期 A/B 全部 28 个注册视图与横切机制：
//   轮 1：thinking / fs.browse 组（Ls+Glob）/ Grep / Bash（gap 停顿 65s）/ fs.write 组
//         （Write+Edit）/ notify / final_answer（tokenUsage → 轮 footer 用量行）
//   轮 2：llm_retry / compaction / fs.search 组（Grep×2）/ max_turns / llm_cancelled /
//         收尾 content（metadata.finish_reason=stop → 树外答案卡）
//   轮 3：任务看板（TaskCreate×2 → TaskUpdate 流转 → TaskList 快照）+ subagent 嵌套
//         （subtask_spawned 双卡 → 子会话流内联直播 → CollectResults 汇总回填）→ final_answer
//   轮 4：实体协作与阻塞闭环——TeamCreate / permission 闭环（同工具 tool_exec 自动
//         granted + permission_denied 独立闭环）/ form 问答（已回答）/ 收尾 content
// 轮收拢 / Agent 行 / 名片四要素 / 组头折叠 / gap 标记 / 子代理折叠策略均由该数据
// 静态驱动（Playwright 验收断言的数据底座，字段口径逐一对照 builder 投影，禁止臆造）。
//
// Context ring 数据源：desktop 取 connectionStore.contextUsage（session.context RPC），
// work connection 插件暂无该服务——静态值 fixtureContextUsage 导出，由 ChatFlowPage
// props 注入最后一轮 footer（window_tokens > 100K 触发「整理对话」按钮阈值）。

import type { ContextUsageInfo } from '../tree/types/content'
import type { ChatMessage, ChatRound } from '../model/message'

export const fixtureSessionId = 's-chatflow-fixture'

/** 会话固定起点（静态数据：时间戳确定性，gap/时长可复算） */
const BASE_MS = Date.UTC(2026, 8, 26, 10, 0, 0)

export function buildFixtureRounds(): ChatRound[] {
  let seq = 0
  const msg = (offsetMs: number, fields: Partial<ChatMessage>): ChatMessage => {
    seq += 1
    return {
      id: `fx${seq}`,
      role: 'assistant',
      content: '',
      timestamp: new Date(BASE_MS + offsetMs).toISOString(),
      sessionId: fixtureSessionId,
      ...fields,
    }
  }

  // ── 轮 1：修复登录页 401（过程工具全景 + 最终答案 + 文件变更/用量 footer） ──
  const r1Messages: ChatMessage[] = [
    msg(0, { role: 'user', content: '登录页一直报 401，帮我排查并修复', metadata: { backendTimestamp: BASE_MS } }),
    msg(1_000, { eventType: 'thinking_done', content: '先看登录相关代码结构，再定位 401 的来源：大概率是 token 过期后没有刷新。' }),
    msg(2_000, {
      eventType: 'tool_exec', eventTitle: 'Ls',
      eventData: {
        status: 'success',
        start: { params: { path: 'src/pages' } },
        end: { duration_ms: 30, result_meta: { entry_count: 12 } },
      },
    }),
    msg(3_000, {
      eventType: 'tool_exec', eventTitle: 'Glob',
      eventData: {
        status: 'success',
        start: { params: { pattern: '**/login*' } },
        end: { duration_ms: 45, result_meta: { match_count: 4 } },
      },
    }),
    msg(5_000, {
      eventType: 'tool_exec', eventTitle: 'Grep',
      eventData: {
        status: 'success',
        start: { params: { pattern: '401', include: '*.ts', output_mode: 'content' } },
        end: { duration_ms: 120, result_meta: { hit_count: 6 } },
      },
    }),
    // 与上一工具间隔 65s（> 30s 阈值）：TreeView 渲染「暂停 1:04」gap 标记
    // （gap = 70_000 − (5_000 + 120) = 64_880ms，格式化 m:ss 得 1:04）
    msg(70_000, {
      eventType: 'tool_exec', eventTitle: 'Bash',
      eventData: {
        status: 'success',
        start: { params: { command: 'pnpm test -- src/pages/login.spec.ts' } },
        end: { duration_ms: 3_400, result: '✓ should refresh token on 401\n✗ should logout when refresh fails', result_meta: { exit_code: 0 } },
      },
    }),
    msg(72_000, {
      eventType: 'tool_exec', eventTitle: 'Write',
      eventData: {
        status: 'success',
        start: { params: { file_path: 'src/utils/auth.ts' } },
        end: {
          duration_ms: 60,
          result: '+  if (error.status === 401) {\n+    await refreshSession()\n+  }',
          result_meta: { write_type: 'overwrite', additions: 24, deletions: 0 },
        },
      },
    }),
    msg(73_000, {
      eventType: 'tool_exec', eventTitle: 'Edit',
      eventData: {
        status: 'success',
        start: { params: { file_path: 'src/pages/Login.vue' } },
        end: {
          duration_ms: 55,
          result: '-  const code = err.response.status\n+  if (err.response.status === 401) await refresh()',
          result_meta: { replace_count: 2, replace_mode: 'literal', additions: 3, deletions: 2 },
        },
      },
    }),
    msg(75_000, {
      eventType: 'tool_exec', eventTitle: 'SendMessage',
      eventData: {
        status: 'success',
        start: { params: { title: '修复完成', message: '登录页 401 已修复，token 过期自动刷新已接入' } },
        end: { duration_ms: 20, result: 'ok' },
      },
    }),
    msg(80_000, {
      eventType: 'final_answer',
      content: '## 排查结论\n\n401 的根因是 **token 过期后未自动刷新**：\n\n1. `auth.ts` 中拦截器只透传错误，未处理 401 分支；\n2. 已补上刷新逻辑：\n\n```ts\nif (error.status === 401) {\n  await refreshSession()\n}\n```\n\n登录页现在会静默续期，不再跳回登录页。',
      tokenUsage: { prompt_tokens: 5_230, completion_tokens: 812, total_tokens: 6_042, cached_tokens: 1_200, call_count: 7 },
      actualTokens: 4_842,
      cost: 0.0421,
      metadata: { backendTimestamp: BASE_MS + 80_000 },
    }),
  ]

  // ── 轮 2：继续重构（系统事件全景：限流重试 / 压缩 / 轮次上限 / 中断） ──────
  const r2Messages: ChatMessage[] = [
    msg(600_000, { role: 'user', content: '继续把重构做完', metadata: { backendTimestamp: BASE_MS + 600_000 } }),
    msg(601_000, { eventType: 'thinking_done', content: '继续前先确认限流恢复，压缩历史上下文再搜索待改点。' }),
    msg(602_000, {
      eventType: 'llm_retry',
      eventData: { provider: 'DeepSeek', model: 'deepseek-chat', status_code: 429, attempt: 1, max_attempts: 3, retry_after_ns: 4_000_000_000 },
    }),
    msg(604_000, {
      eventType: 'compaction',
      eventData: { messages_slid: 42, window_tokens: 38_400, max_window_size: 128_000 },
    }),
    msg(606_000, {
      eventType: 'tool_exec', eventTitle: 'Grep',
      eventData: {
        status: 'success',
        start: { params: { pattern: 'useAuth', include: '*.vue', output_mode: 'files_with_matches' } },
        end: { duration_ms: 90, result_meta: { hit_count: 5 } },
      },
    }),
    msg(607_000, {
      eventType: 'tool_exec', eventTitle: 'Grep',
      eventData: {
        status: 'success',
        start: { params: { pattern: 'refreshSession', include: '*.ts', output_mode: 'content' } },
        end: { duration_ms: 70, result_meta: { hit_count: 9 } },
      },
    }),
    msg(609_000, {
      eventType: 'max_turns_reached',
      eventData: { turns_completed: 10, max_turns: 10, suggestion: '你可以发送 "继续" 让 AI 继续处理当前任务。' },
    }),
    msg(611_000, { eventType: 'llm_cancelled', eventData: { elapsed_ns: 12_500_000_000 } }),
    msg(613_000, {
      eventType: 'content_delta',
      content: '本轮已定位全部待改点（`Login.vue` / `auth.ts` / `api.ts`），发送「继续」即可接着执行替换。',
      metadata: { finish_reason: 'stop' },
    }),
  ]

  // ── 轮 3：任务看板 + subagent 嵌套（子会话流内联直播 + CollectResults 收口） ──
  const r3Messages: ChatMessage[] = [
    msg(1_200_000, {
      role: 'user',
      content: '并行派两个子代理分别调研缓存与鉴权方案，建两个跟踪任务，最后汇总结论',
      metadata: { backendTimestamp: BASE_MS + 1_200_000 },
    }),
    // 任务看板：TaskCreate×2 → TaskUpdate 流转 → TaskList 权威快照
    // （TaskCreate/Update 不落工具节点，按 task_id 实体 upsert——归一规则 3）
    msg(1_201_000, {
      eventType: 'tool_exec', eventTitle: 'TaskCreate',
      eventData: {
        status: 'success',
        start: { params: { subject: '调研前端缓存方案' } },
        end: { duration_ms: 15, result: JSON.stringify({ task_id: 'T-100', subject: '调研前端缓存方案', status: 'pending' }) },
      },
    }),
    msg(1_201_500, {
      eventType: 'tool_exec', eventTitle: 'TaskCreate',
      eventData: {
        status: 'success',
        start: { params: { subject: '调研鉴权库选型' } },
        end: { duration_ms: 12, result: JSON.stringify({ task_id: 'T-101', subject: '调研鉴权库选型', status: 'pending' }) },
      },
    }),
    msg(1_202_000, {
      eventType: 'tool_exec', eventTitle: 'TaskUpdate',
      eventData: {
        status: 'success',
        start: { params: { task_id: 'T-100', status: 'in_progress' } },
        end: { duration_ms: 10, result: JSON.stringify({ task_id: 'T-100', status: 'in_progress' }) },
      },
    }),
    msg(1_202_400, {
      eventType: 'tool_exec', eventTitle: 'TaskUpdate',
      eventData: {
        status: 'success',
        start: { params: { task_id: 'T-101', status: 'in_progress' } },
        end: { duration_ms: 9, result: JSON.stringify({ task_id: 'T-101', status: 'in_progress' }) },
      },
    }),
    // subagent 双卡：subtask_spawned 双事件 upsert（观察窗正式创建入口，归一规则 11）
    msg(1_203_000, {
      eventType: 'subtask_spawned',
      eventData: { session_id: 'sub-cache', agent_name: 'CacheScout', description: '调研前端请求层缓存方案（lru / TTL / SWR）' },
    }),
    msg(1_203_100, {
      eventType: 'subtask_spawned',
      eventData: { session_id: 'sub-auth', agent_name: 'AuthScout', description: '调研鉴权库选型（JWT 刷新 / 会话续期）' },
    }),
    // CollectResults 收口：结果数组按 session_id 回填对应 subagent 卡完成状态（审计闭环）
    msg(1_206_000, {
      eventType: 'tool_exec', eventTitle: 'CollectResults',
      eventData: {
        status: 'success',
        start: { params: { session_ids: ['sub-cache', 'sub-auth'] } },
        end: {
          duration_ms: 40,
          result: JSON.stringify([
            { session_id: 'sub-cache', status: 'completed', result: '缓存建议：请求层引入 **lru-cache**，TTL 30s，SWR 策略兜底陈旧数据。' },
            { session_id: 'sub-auth', status: 'completed', result: '鉴权建议：沿用现有 JWT 刷新链路，补充 401 静默续期即可，无需引入新依赖。' },
          ]),
        },
      },
    }),
    msg(1_206_500, {
      eventType: 'tool_exec', eventTitle: 'TaskUpdate',
      eventData: {
        status: 'success',
        start: { params: { task_id: 'T-100', status: 'completed' } },
        end: { duration_ms: 8, result: JSON.stringify({ task_id: 'T-100', status: 'completed' }) },
      },
    }),
    msg(1_206_900, {
      eventType: 'tool_exec', eventTitle: 'TaskUpdate',
      eventData: {
        status: 'success',
        start: { params: { task_id: 'T-101', status: 'completed' } },
        end: { duration_ms: 8, result: JSON.stringify({ task_id: 'T-101', status: 'completed' }) },
      },
    }),
    // TaskList：看板快照的权威来源（工具节点 + 刷新留档快照）
    msg(1_207_500, {
      eventType: 'tool_exec', eventTitle: 'TaskList',
      eventData: {
        status: 'success',
        start: { params: {} },
        end: {
          duration_ms: 18,
          result: JSON.stringify({
            tasks: [
              { task_id: 'T-100', subject: '调研前端缓存方案', status: 'completed' },
              { task_id: 'T-101', subject: '调研鉴权库选型', status: 'completed' },
            ],
          }),
        },
      },
    }),
    msg(1_208_500, {
      eventType: 'final_answer',
      content: '## 调研结论\n\n两个子代理已完成并行调研：\n\n- **缓存**：lru-cache + TTL 30s + SWR 兜底；\n- **鉴权**：沿用 JWT 刷新链路，补 401 静默续期。\n\n两项跟踪任务已全部完结。',
      tokenUsage: { prompt_tokens: 8_120, completion_tokens: 640, total_tokens: 8_760, cached_tokens: 2_100, call_count: 9 },
      actualTokens: 6_660,
      cost: 0.0568,
      metadata: { backendTimestamp: BASE_MS + 1_208_500 },
    }),
  ]

  // ── 轮 4：实体协作与阻塞闭环（TeamCreate / permission 双闭环 / form 问答） ──
  const r4Messages: ChatMessage[] = [
    msg(1_800_000, {
      role: 'user',
      content: '清一下临时目录，涉及删除操作先问我',
      metadata: { backendTimestamp: BASE_MS + 1_800_000 },
    }),
    // TeamCreate 落 team 实体卡（登记型一次性动作；参数名对齐 goharness team_create.go）
    msg(1_801_000, {
      eventType: 'tool_exec', eventTitle: 'TeamCreate',
      eventData: {
        status: 'success',
        start: {
          params: {
            team_name: '清理小组',
            leader: 'MainAgent',
            members: ['MainAgent', 'FileAgent'],
            description: '一次性临时目录清理协作',
          },
        },
        end: { duration_ms: 35, result: 'ok' },
      },
    }),
    // permission 闭环一：high 级授权请求 → 同名工具实际执行自动闭合 granted
    // （阻塞授权的审计闭环：请求 + 决定 = 完整留痕，closeOpenPermission）
    msg(1_802_000, {
      eventType: 'permission_request',
      eventData: {
        tool_name: 'Bash',
        params: { command: 'rm -rf .cache/tmp' },
        security_level: 'high',
        reason: '删除临时缓存目录需要删除权限',
      },
    }),
    msg(1_803_000, {
      eventType: 'tool_exec', eventTitle: 'Bash',
      eventData: {
        status: 'success',
        start: { params: { command: 'rm -rf .cache/tmp' } },
        end: { duration_ms: 210, result: '', result_meta: { exit_code: 0 } },
      },
    }),
    // permission 闭环二：请求 → permission_denied 独立闭环（拒绝留痕，failed 红）
    msg(1_804_000, {
      eventType: 'permission_request',
      eventData: {
        tool_name: 'Write',
        params: { file_path: '清理报告.md' },
        security_level: 'medium',
        reason: '写入清理报告文件',
      },
    }),
    msg(1_804_500, {
      eventType: 'permission_denied',
      eventData: { tool_name: 'Write', reason: '用户拒绝：先出预览再写入' },
    }),
    // form 问答（AskUser 阻塞原语留痕）：轮已收尾 → status success「已回答」
    msg(1_805_000, {
      eventType: 'form',
      eventData: {
        questions: [
          { question: '清理范围是否包含 node_modules？', options: ['仅临时目录', '包含 node_modules'], multi_select: false },
        ],
        answers: [
          { question: '清理范围是否包含 node_modules？', answer: '仅临时目录' },
        ],
      },
    }),
    msg(1_806_000, {
      eventType: 'content_delta',
      content: '已按你的选择清理临时目录（`rm -rf .cache/tmp`），报告写入已取消。',
      metadata: { finish_reason: 'stop' },
    }),
  ]

  return [
    { key: 'round-1', userMessage: r1Messages[0]!, messages: r1Messages, hasFinalAnswer: true },
    { key: 'round-2', userMessage: r2Messages[0]!, messages: r2Messages, hasFinalAnswer: false },
    { key: 'round-3', userMessage: r3Messages[0]!, messages: r3Messages, hasFinalAnswer: true },
    { key: 'round-4', userMessage: r4Messages[0]!, messages: r4Messages, hasFinalAnswer: true },
  ]
}

/**
 * 子会话消息流（子会话 ID → 消息数组）：轮 3 两个 subagent 节点的内联直播数据源
 * （buildTreesForRounds opts.subagentStreams → 工作块 E 嵌套 children）。
 * 子流与主会话流走同一 builder 归一化路径（thinking / 工具 / 内容事件同构）；
 * 尾部 subtask_completed 事件驱动 tailSettled 判定（跨 pass 重建时兜底收尾态）。
 */
export function fixtureSubagentStreams(): Record<string, ChatMessage[]> {
  let seq = 0
  const subMsg = (subId: string, offsetMs: number, fields: Partial<ChatMessage>): ChatMessage => {
    seq += 1
    return {
      id: `${subId}-fx${seq}`,
      role: 'assistant',
      content: '',
      timestamp: new Date(BASE_MS + offsetMs).toISOString(),
      sessionId: subId,
      ...fields,
    }
  }

  const cacheStream: ChatMessage[] = [
    subMsg('sub-cache', 1_203_000, { eventType: 'thinking_done', content: '先盘现有请求层有没有缓存痕迹，再对比 lru 与 SWR 两种策略。' }),
    subMsg('sub-cache', 1_203_500, {
      eventType: 'tool_exec', eventTitle: 'Grep',
      eventData: {
        status: 'success',
        start: { params: { pattern: 'cache|ttl', include: '*.ts', output_mode: 'files_with_matches' } },
        end: { duration_ms: 60, result_meta: { hit_count: 5 } },
      },
    }),
    subMsg('sub-cache', 1_205_000, {
      eventType: 'content_delta',
      content: '缓存结论：请求层引入 **lru-cache**（上限 50 条），TTL 30s；SWR 策略兜底陈旧数据。',
    }),
    subMsg('sub-cache', 1_205_800, {
      eventType: 'subtask_completed',
      eventData: { session_id: 'sub-cache', agent_name: 'CacheScout', success: true, answer: '缓存建议：lru-cache + TTL 30s + SWR 兜底。' },
    }),
  ]

  const authStream: ChatMessage[] = [
    subMsg('sub-auth', 1_203_100, { eventType: 'thinking_done', content: '对比主流鉴权方案与现有 JWT 链路的差距，判断是否需要换库。' }),
    subMsg('sub-auth', 1_203_800, {
      eventType: 'tool_exec', eventTitle: 'Glob',
      eventData: {
        status: 'success',
        start: { params: { pattern: '**/auth*.ts' } },
        end: { duration_ms: 35, result_meta: { match_count: 3 } },
      },
    }),
    subMsg('sub-auth', 1_205_400, {
      eventType: 'content_delta',
      content: '鉴权结论：现有 JWT 刷新链路完备，仅需补充 401 静默续期，无需引入新依赖。',
    }),
    subMsg('sub-auth', 1_205_900, {
      eventType: 'subtask_completed',
      eventData: { session_id: 'sub-auth', agent_name: 'AuthScout', success: true, answer: '鉴权建议：沿用现有 JWT 刷新链路，补 401 静默续期。' },
    }),
  ]

  return { 'sub-cache': cacheStream, 'sub-auth': authStream }
}

/**
 * 上下文用量静态值（session.context RPC 投影形态，desktop connectionStore.contextUsage
 * 同源字段；消费方：输入区工具栏 ContextUsageGauge）：window_tokens 118,400 > 100K
 * 阈值（「整理对话」按钮可见）、usage_ratio 0.925 ≥ 0.80（进度条危险红阶）——
 * 一次覆盖两个验收断言点。
 */
export const fixtureContextUsage: ContextUsageInfo = {
  window_tokens: 118_400,
  max_window_size: 128_000,
  usage_ratio: 0.925,
  message_count: 46,
  cursor: 46,
  active_message_count: 12,
  total_actual_tokens: 236_800,
  total_cost: 0.8412,
}

// ── 五期槽位 fixture（?fixture=slot）────────────────────────────────────────
// 单轮最小流：用户消息 + 槽位认领工具（Deploy，不在内建工具对照表）执行 + 收尾答案。
// builder 经槽位注册表把 Deploy 归一为贡献节点（type = 槽位键 tool.deploy），
// 渲染由 fixture 扩展注册的 standalone 视图承接（Playwright 断言渲染出口）。
export function buildSlotFixtureRounds(): ChatRound[] {
  const userMessage: ChatMessage = {
    id: 'sx-user',
    role: 'user',
    content: '把 web 服务的 v2.3.0 部署到预发环境',
    timestamp: new Date(BASE_MS).toISOString(),
    sessionId: fixtureSessionId,
  }
  const messages: ChatMessage[] = [
    userMessage,
    {
      id: 'sx1',
      role: 'assistant',
      content: '',
      timestamp: new Date(BASE_MS + 1_000).toISOString(),
      sessionId: fixtureSessionId,
      eventType: 'tool_exec',
      eventTitle: 'Deploy',
      eventData: {
        status: 'success',
        start: { params: { service: 'web', version: 'v2.3.0', target: '预发集群' } },
        end: {
          duration_ms: 4_200,
          result: '滚动更新完成：副本 3/3 就绪，健康检查全部通过',
          result_meta: { replicas: 3, ready: 3 },
        },
      },
    },
    {
      id: 'sx2',
      role: 'assistant',
      content: 'v2.3.0 已部署到预发集群，副本 3/3 就绪。',
      timestamp: new Date(BASE_MS + 6_000).toISOString(),
      sessionId: fixtureSessionId,
      eventType: 'final_answer',
    },
  ]
  return [{ key: 'slot-round-1', userMessage, messages, hasFinalAnswer: true }]
}
