# 用量页永久卡在"加载中…"——渲染崩溃而非接口挂死

日期：2026-09-29
位置：mindx-work/plugins/src/usage/UsageView.vue

## 现象

用量页月度汇总区永久显示"加载中…"，下方"当前会话明细"却有数据，观感是 RPC 挂死。

## 根因

- daemon `buildMonthlyStats` 返回的 `daily_usage`/`model_breakdown` 条目字段为 `input_tokens`/`output_tokens`；
- UsageView.vue 移植自 mindx-desktop，类型与模板按 desktop 写成 `prompt_tokens`/`completion_tokens`；
- 模板"按模型"表 `formatCount(row.prompt_tokens)` → `undefined.toLocaleString()` → 渲染函数抛错；
- Vue 更新中止，DOM 冻结在崩溃前最后一帧（"加载中…"），此后每次更新重复崩溃，无任何弹窗——会话明细表格是在更早一次成功渲染中更新的，所以它正常。

## 证据链（全程实证，零猜测）

1. python websockets 直连 ws://localhost:1314/ws 发 `token.usage.monthly` → 104ms 返回完整数据（2234 请求/19 天/6 模型）→ 排除 daemon 挂死；
2. CDP（electron 已开 9333）读 `el.__vueParentComponent.setupState`：`monthlyLoading=false`、`monthly` 有数据，但 DOM 仍是"加载中…" → 状态与 DOM 脱节；
3. CDP 点击"下一月/上一月"强制重渲染，pageerror 捕获 `Cannot read properties of undefined (reading 'toLocaleString')` + Vue warn "Unhandled error during execution of render function at <UsageView>" → 坐实；
4. 探针核对 daemon 响应 JSON 条目字段 → 确认 `input_tokens`/`output_tokens`；
5. 修复字段名后 HMR 重挂载：3 汇总卡（¥20.03 / 35,575,418 / 2,234）+ 19 条形 + 6 模型行全部渲染，无报错。

## 修复

UsageView.vue 接口与模板字段对齐：`prompt_tokens`→`input_tokens`、`completion_tokens`→`output_tokens`。

## 可复用经验

- 「界面永久卡在加载态」优先怀疑渲染函数崩溃（CDP 对比 setupState 与 DOM），别一头扎进 RPC/网络排查；
- 移植组件时 RPC 返回字段名必须以 daemon 实测响应为准，先发真实探针再写 interface；
- 渲染期一个 `undefined.toLocaleString()` 就能把整个视图砖化且无提示，数据消费点遇到新字段先核对来源。
