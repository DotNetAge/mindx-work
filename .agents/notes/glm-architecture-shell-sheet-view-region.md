# 壳新增 Sheet 全屏抽层视图区（七区定稿）

日期：2026-10-02 ｜ 分类：架构/壳能力 ｜ 状态：已完成（typecheck + app build 通过）

## 任务

用户要求新增第三种浮层级壳能力 sheet，与 Overlay、对话框同为公共能力：效果与 Element Plus Drawer 一致——由下向上滑入覆盖整个界面，头部中部 Title、尾端（右上角）X 关闭。

## 设计定稿（全部对齐既有先例，零发明）

- **核心层（ui-shell）**：新增第七视图区 `Sheet`，不是 Overlay 的新 kind（契约 §8.2 原定「sheet 归插件局部渲染」同步废止）。
  - `views.ts`：`SheetEntry<C> = Entry<C> & { title: string }`；`SheetViewApi`（add/remove/has/entries）；`createSheetView` 强制互斥（已有条目再 add 抛错，对齐 modal 互斥先例）+ title 缺失抛错（零文案壳：标题由注册者提供、壳渲染）。
  - `createApp.ts`：AppShell 加 `readonly Sheet: SheetViewApi<C>`。
  - `index.ts`：导出 `SheetEntry` / `SheetViewApi`。
- **适配层（ui-shell-vue）**：`SheetPane.vue` + AppFrame 装配（OverlayPane 之后）。
  - 全屏覆盖 `position: fixed; inset: 0`，无遮罩（本体即覆盖层）。
  - 入场 `translateY(100%) → none`（Drawer 语义，`--mx-duration-motion` + `--mx-ease-standard`），退场 Transition leave-active 倒放（对齐 OverlayPane 模式：入场靠元素自身 animation，Transition 只管退场 animationend 后卸载）。
  - 头部 54px 对齐 SettingsPane header 几何；Title 绝对定位水平居中（左右控件不等宽不偏移）+ 长标题 ellipsis；关闭钮 `margin-left: auto` 贴右，观感用全局 `mx-icon-btn` 类（同 banner 固有关闭控件先例），aria-label="关闭"（零文案壳允许 aria，先例「关闭通知」）。
  - 本体 `flex:1; overflow-y:auto` 渲染条目组件。
- **z-index 62（层级表定稿）**：设置 60 < sheet 62 < banner 65 < modal 70。依据：设置行内唤起 sheet 必须盖住设置（历史 bug：modal 曾 50 < 60 被盖）；sheet 内动作触发的通知与确认 modal 必须可见（历史 bug：「通知栏永远会被遮挡」）。
- **Esc 分层**：SheetPane 捕获期监听，双守卫——`event.defaultPrevented`（更高层已认领）+ modal 在场检查。两守卫合起来对监听器注册顺序与 useShellData 同步性都稳：OverlayPane 先注册先执行，关 modal 后 preventDefault 已置位，SheetPane 跳过；反向顺序时 modal 在场守卫兜底。一次 Esc 只关一层。
- **MX_API_VERSION 不递增**：新增视图区对动态插件是纯增量 API 面，旧 manifest 插件不受影响（契约规则「新增可选字段不破坏契约」的推广）。

## 实踩坑（已录 AGENTS.md）

**CSS Modules 内引用全局类名会被哈希失配**：`<style module>` 写 `.sheetHeader .mx-icon-btn`，`.mx-icon-btn` 被当本地类哈希，匹配不到模板字面 `class="mx-icon-btn"`，规则整条静默失效。解法：全局类只管观感写在模板 class，布局另配 `$style` 模块类（本次用 `$style.sheetClose`）；或 `:global(.mx-icon-btn)`。与已录的「scoped CSS `:global(祖先) .后代` 后代选择器被丢」是姊妹坑但机制不同。

## 文档同步面（改壳必须同步的完整清单，本次实践）

1. `docs/组件层契约.md`：§2 七锚点、§4 新增 Sheet 节、§5 AppShell 面、§8.2 编排语义、§10 硬约束（modal/sheet 互斥）。
2. `mx-plugin-dev/references/contract.md`（插件权威 API 参考）：标题七区、§2 十席位、新增 §6.1（插在 Overlay 后，**不重编号**——§12/§17/§18 被多处引用）、§9 AppShell、§12 校验表、§13.2、§14 几何图 + z-index 层级表 + Esc 分层、§16、§17、§18。
3. `mx-plugin-design/references/seats.md`：席位映射表加 Sheet 行（否则设计技能无法选出新席位）。
4. 泛称「六区/六视图区」→「七区/七视图区」：mx-dev-guide（SKILL + architecture + project-layout）、mx-uikit、mx-audit（SKILL + checklists）、mx-plugin-design、mx-plugin-dev SKILL、`docs/界面层选型.md`、demo 插件（OverviewPage 用户可见文案 + zones 列表加 Sheet 项）。
5. 保留不动：`.trae/documents/` 历史快照、demo store.ts 的历史清单项（描述当时完成的事，非现状）。

## 消费方式（插件视角）

```ts
const SHEET_ID = 'xxx-manager-sheet'
shell.Sheet.add({ id: SHEET_ID, title: '标题', component: XxxPanel })   // 互斥：开第二个前先 remove
shell.Sheet.remove(SHELL_ID)   // 关闭 = 移除（右上 X / Esc 同样走 remove）
```

order 字段存在但互斥单开下无排序意义；标题长会自动截断。
