# 壳新增 Floater 可拖动浮窗视图区（八区定稿）

日期：2026-10-02 ｜ 分类：架构/壳能力 ｜ 状态：已完成（typecheck + app build 通过）

## 任务

用户要求新增可拖动浮窗能力：风格与主窗一致，不要 titlebar，但显示 title 并模拟 macOS 交通灯——只要红灯（点击关闭）。

## 设计定稿（对齐既有先例 + 用户明确表述）

- **核心层（ui-shell）**：第八视图区 `Floater`。
  - `views.ts`：`FloaterEntry<C> = Entry<C> & { title: string; width?: number; height?: number }`（width/height 对齐 DetailEntry.preferredWidth 先例——条目属性声明几何，缺省由适配层定）；`FloaterViewApi` 同 Sheet 同构；`createFloaterView` 仅校验 title 缺失抛错，**允许多开不互斥**（浮窗本义，多窗并存各自独立）。
  - `createApp.ts` / `index.ts`：AppShell 加 `readonly Floater` + 导出类型。
- **适配层（ui-shell-vue）**：`FloaterPane.vue` + AppFrame 装配（SheetPane 之后）。
  - 窗体：`--mx-bg-elevated` + `--mx-radius-window` + `--mx-shadow-lv3`（首段 1px 实色描边锐利边界，modal 卡先例）+ overflow hidden。
  - 头部：36px 细带（不是传统 titlebar），左侧 **12px 红灯圆点**（新 token `--mx-traffic-light-close` = #ff5f57 Apple 官方色，双主题同值，同 `--mx-mask-blur` 先例只在 :root 定义）+ hover 显 ×（::after content '×' + color-mix 基于 token，禁字面色值）；红灯旁标题 13px/500；按住头部拖动。
  - 拖动：pointerdown 记偏移 + `setPointerCapture`（move 持续派发到头部即使指针出界）；clamp 保证头部始终可抓（x ∈ [-(w-60), vw-60]，y ∈ [0, vh-36]）；红灯按钮 `@pointerdown.stop` 防误启拖动。
  - 多窗并存：位置存 `reactive(Map<id,{x,y}>)`，新条目 watch immediate 初始化（右下角错位叠放，idx%5）；**点击置顶** = frontOrder 秩数组排序 v-for（DOM 顺序 = 同层叠放次序），任意 pointerdown.capture 触发 bringToFront。
  - z-index 55：Content 5 之上、任何浮层族（设置 60/sheet 62/banner 65/modal 70/menu 100）之下——浮窗永不遮蔽通知与确认框。
  - 不抢 Esc、无遮罩不阻塞；关闭通道 = 红灯 / 注册者自行 remove；位置刷新重置（持久化为契约开放点）。
  - 入场轻量淡入上浮（banner 同型，比 modal 的 0.82 缩放轻）；Transition leave 倒放。
- **demo 消费入口**：OverviewPage「打开浮窗」按钮（seq 递增多开演示）+ DemoFloater 内容组件 + zones 加 Floater 行。

## 过程坑（工具层，非代码层）

- 本轮 2 次 Edit 因「invalid params: missing field old_string」反序列化失败**静默未执行**——同批次其他 Edit 成功，极易漏检。教训：批量并行 Edit 后，对关键类型定义必须 grep/read 复核落盘（本轮靠 typecheck 前的 grep 复查发现类型缺失补齐）。

## 文档同步面（八区清单，Sheet 轮同款全量执行）

契约文档 §2/§4/§5/§8.2；contract.md 标题/§2 十一席位/§6.2/§9/§12 校验表/§14 层级表（Floater 55）/§13/§17/§18；seats.md 加 Floater 行；mx-dev-guide（SKILL 列表加 Floater/architecture/project-layout）；mx-uikit（token 表加交通灯红）；mx-audit；mx-plugin-design；mx-plugin-dev SKILL description；界面层选型.md；demo（index.ts 注释 + OverviewPage 文案八视图区）。

## 出现/消失动画预设（2026-10-02 二轮补充）

- 条目新增 `animation?: FloaterAnimation`（`'zoom' | 'fade' | 'none'`，缺省 `'zoom'`）：zoom = 放大出现、缩小消失（对齐用户定稿的对话框 Apple 动画：scale 0.82 + `--mx-ease-standard`）；fade = 纯淡入淡出；none = 瞬时出现/消失。非法值抛错（对齐 OverlayKind 先例）。
- 实现：入场为动态 class（`enterClassOf`），退场为 `:leave-active-class="leaveClassOf(entry)"`——v-for 每条目独立 Transition，prop 可按条目选择；none 无退场类 → 无动画时长即瞬时卸载（Transition 既有机制）。
- **script 内取模块类必须 `useCssModule()`**：`$style` 仅模板作用域自动注入，script 函数里直接 `$style.xxx` 运行时 undefined 且类型检查不报（已录 AGENTS.md）。
- 根元素不再自带常驻入场动画（原 float-in 移除），动画全由动态类提供；reduced-motion 禁全部四个动画类。

## 消费方式（插件视角）

```ts
const id = `xxx-floater-${seq}`
shell.Floater.add({ id, title: '迷你面板', component: MiniPanel, width: 320, height: 240 })
shell.Floater.add({ id, title: '通知小窗', component: Toast, animation: 'fade' })   // 动画预设
shell.Floater.remove(id)   // 关闭 = 移除（红灯同走此路）
```
