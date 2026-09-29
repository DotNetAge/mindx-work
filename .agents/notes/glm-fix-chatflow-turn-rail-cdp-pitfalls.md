# chatflow 波浪轮次指示器（TurnRail）与 CDP 验证坑

时间：2026-09-29

## 功能事实（已实测）

- 新组件 `plugins/src/chatflow/content/TurnRail.vue`：豆包同款左侧轮次刻度尺，已接入 `ChatFlowPage.vue` 的 streamWrap（absolute 左缘，z-index 5，低于骨架屏 10）。
- 波浪三件套：
  1. 每轮一根 2px 圆角刻度，行高 `--rail-row-h` 固定 14px（轮次多时按 rail 高度压缩至最小 6px），整列 `justify-content: center` 垂直居中；
  2. 目标宽度 = `BASE_W + add × exp(-d²/2σ²)`（高斯衰减），**σ/add 必须随实测行距自适应**（`σ = clamp(rowH×1.6, 16, 40)`、`add = clamp(rowH×1.4, 10, 22)`）——首版行 flex:1 均分导致行距 284px、σ 上限 40px，最近刻度 d≈142 远超 σ，波浪完全失效（全 12px 基准宽）；
  3. rAF 每帧 `w += (target - w) × 0.18` 插值——插值造成的响应时差即"波浪拖尾"；`prefers-reduced-motion` 时系数取 1 退化为直接赋值。
- 行高重算：ResizeObserver 观察 rail + `watch(rounds.length) → nextTick` 双通道。
- 窄流隐藏：streamWrap 设 `container: chatflow-stream / inline-size`，rail 内 `@container (max-width: 1023px)` 隐藏。断点依据：内容 920 + 边距 56×2 + rail 占用 ~50px。**注意 streamWrap 必须加 container-type，且 inline-size containment 不影响其纵向 flex 布局**。
- 点击跳轮：rail 刻度绑定**全量轮次**（渲染窗只裁剪 DOM），`handleRoundSelect` 先扩渲染窗（`renderWindowEnd = min(len, need + RENDER_PAGE)`）再 `nextTick + rAF + scrollIntoView`（二次 rAF 等 transition-group 入场布局）。
- CDP 实测数据（fixture=rounds）：hover 中心行宽 32px、两侧 28→21 递减；移开 900ms 后全回落 12px；真实会话（14 轮）滚底 active=10，点击第 1 刻度后渲染窗 4→14、scrollH 15341、第一轮贴顶对齐、active=1。
- 伸长方向（用户纠正 2026-09-29）：刻度必须**左端锚定、向右伸长**（伸入内容区方向）——首版 `.row` 用 `justify-content: flex-end` 导致向左伸、顶到窗口边缘，已改 `flex-start`。豆包原版即左锚右伸。

## CDP / Electron 坑（本次翻车实录）

- **work 的 dev 是两段式**：`pnpm --filter @mindx-work/app dev` 只起 vite(:5273)；Electron 单独起 `Electron electron --remote-debugging-port=9333`（cwd = mindx-work 根，app 路径 `electron/` 即 electron 包目录）。CDP :9333 挂在 Electron 主进程上。
- **Playwright connect_over_cdp 下 `ctx.new_page()` 报 Not supported**（Target.createTarget 被禁）→ 只能复用 `ctx.pages[0]`。**复用的页面是应用真实窗口，绝不能 `page.close()`**——本次把 work 窗口关了（CDP targets 清空），恢复靠杀掉 Electron 主进程重启 + 重启 vite。
- 测完恢复现场用 `page.goto(origin_url)`，不要 close。
- **`[class*="stream"]` 选择器陷阱**：`_streamWrap_` 也含 "stream"，querySelector 按 DOM 序先命中父元素 streamWrap（scrollHeight 恒等于 clientHeight），滚动验证全假数据。精确定位滚动容器：rail.parentElement 的子元素中 `overflowY === 'auto'` 的那个。

## 类型检查

- 插件 tsconfig 开 `noUncheckedIndexedAccess`：数组索引访问一律 `?? 兜底`（widths[i]、props.rounds[i]）。
- 既有错误 `src/models/providerIcons.ts` 的 `ImportMeta.glob` 与本组件无关，勿误判为新引入。
