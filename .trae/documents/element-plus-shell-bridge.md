# Element Plus 壳单例供给 + --el-\* 全量桥接 --mx-\*

## Context

多插件将使用 Element Plus（行业事实标准的 Vue 组件库）。为避免每插件复制一份 EP 造成 zIndex 计数器分裂、provide/inject 断裂、暗色双变量源，用户拍板：**壳单例供给 EP，且全量主题桥接——所有** **`--el-*`** **变量跟随** **`--mx-*`** **token，亮暗双主题全自动**。

分工边界（用户裁决）：**mx-uikit 优先**——基础控件（按钮/输入框/开关/页签/标签等）继续 mx-uikit；EP 仅用于 mx-uikit 未覆盖的复杂组件（date-picker/table/tree/cascader/upload 等）；同屏不混用同类控件。存量界面与已交付三插件不迁移。

关键实证（勿重查）：

* 内置插件是 workspace 源码直引（`plugins/package.json` exports 全为 `./src/*.ts`），app 统一 vite 编译 → 与壳同 module graph，**天然单例**，无 import map 问题

* 市场插件（`mx-plugin://` 动态 .mjs）无 import 通道（RenderKit `{ h, MxIcon }` 注入），本次**不扩**，未来可增补白名单

* 主题机制：`theme.ts` 写 `documentElement` 的 `data-mx-theme`（EP 官方暗色挂 `html.dark`，**不引** `dark/css-vars.css`，避免双变量源）

* 样式入口：`ui-shell-vue/src/index.ts` L3-4（tokens.css → controls.css），EP 样式插其后

* `mountVueApp.ts` L12-18 内部才 `createVueApp`，main.ts 拿不到 app 实例 → 需加 configure 参数

* pnpm 隔离 node\_modules：插件直写 `import 'element-plus'` 是幻影依赖 → **必须经** **`@mindx-work/ui-shell-vue`** **re-export 消费**

* z 序现状：壳 60/70、tooltip/menu 1100、技能 FLIP 2000/2001 → EP zIndex 初值须抬到 3000 断开

* 控件几何：mx-btn/mx-input 实高 32px = EP 默认 `--el-component-size: 32px`，天然对齐免调参

* `--mx-danger`（亮 rgb(239,68,68)）与 `--mx-state-error`（rgb(236,19,19)）并存，EP danger 统一取 `--mx-danger`

## 施工步骤

### 1. 安装依赖（唯一声明家：ui-shell-vue）

```bash
pnpm --filter @mindx-work/ui-shell-vue add element-plus
```

### 2. 供给出口 — `ui-shell-vue/src/index.ts`

import 顺序（桥接表必须晚于 theme-chalk，同为 `:root` 后者胜）：

```ts
import './styles/tokens.css'
import './styles/controls.css'
import 'element-plus/dist/index.css'          // 不引 dark/css-vars.css
import './styles/element-plus.css'            // 新建桥接表
export * from 'element-plus'                  // 组件 + ElementPlus 默认导出
export { default as ElementPlusZhCn } from 'element-plus/es/locale/lang/zh-cn'
```

插件统一 `import { ElXxx } from '@mindx-work/ui-shell-vue'`。

### 3. 桥接表 — 新建 `ui-shell-vue/src/styles/element-plus.css`

全部覆写 `:root`（不引 EP 官方 dark 包）：

**A 品牌梯度**（color-mix 派生，controls.css 已有同法先例）：

* `--el-color-primary: var(--mx-accent)`；light-3/5/7/8/9 = `color-mix(in srgb, var(--mx-accent) 70%/50%/30%/20%/10%, #fff)`；dark-2 = 80% 混 #000

* success/warning/danger/info 同法派生自 `--mx-success/--mx-warning/--mx-danger/--mx-business`

**B 中性板**：

| --el-\*                                                        | 映射                                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| text-color primary/regular/secondary/placeholder/disabled      | `--mx-text` / `-secondary` / `-tertiary` / `-caption` / `-caption`                     |
| border-color default·light / lighter·extra-light / dark        | `--mx-separator` / `--mx-separator-soft` / `--mx-border-strong`                        |
| fill-color blank/default/light·lighter/extra-light/dark·darker | `--mx-bg-elevated` / `--mx-hover-solid` / `--mx-hover` / `--mx-module` / `--mx-active` |
| bg-color / page / overlay / mask-color                         | `--mx-bg-elevated` / `--mx-bg-surface` / `--mx-bg-elevated` / `--mx-mask`              |

**C 几何/字体/阴影**：`--el-font-family: var(--mx-font-family)`、font-size-base 14px、component-size 32px、radius base/small/round = `--mx-radius-control`/4px/999px、box-shadow = `--mx-shadow-lv3/-panel/-prominent`（壳亮暗同值，有意一致）、transition = `--mx-duration-fast`

**D 暗色块** **`:root[data-mx-theme='dark']`（仅例外项）**：

* 中性板全组**无需重写**——值是 `var(--mx-*)` 引用，切主题自动解析暗值

* 必须重指：① 品牌梯度 mix 基色（暗色 accent 已变亮蓝，再混白过曝 → light-N 基色换 `#141414`、dark-2 基色换 #fff，五色组同理）；② `--el-color-white/black` 兜底反转（white→`var(--mx-bg-elevated)`、black→`var(--mx-text)`）

### 4. 装配参数 — `ui-shell-vue/src/mountVueApp.ts`

加可选第三参 `configure?: (app: App) => void`，在 `app.use(createPinia())` 后、`app.mount` 前调用。保持通用性，EP 语义留壳入口。

### 5. EP 装配 — `app/src/main.ts`

```ts
mountVueApp(shell, '#app', (app) => app.use(ElementPlus, { locale: ElementPlusZhCn, zIndex: 3000 }))
```

（ElementPlus / ElementPlusZhCn 均从 `@mindx-work/ui-shell-vue` 引，app 不直依赖 element-plus）
zIndex 3000 断开既有全部层（FLIP 2000/2001 之下不冲突），军规注明分带：mx 弹层 ≤2100，EP 弹层 ≥3000。

### 6. 军规补条目 — `docs/界面军规.md` 新增「五、组件库军规」

1. EP 为壳特许供给的通用组件库，统一经 `@mindx-work/ui-shell-vue` 消费，禁直接声明/导入 `element-plus`
2. 分工边界：mx-uikit 优先（基础控件）；EP 仅补 mx-uikit 未覆盖的复杂组件；同屏不混用同类控件
3. 使用 EP 时禁字面色值，只走 `--el-*`/`--mx-*`（军规 4 延伸）
4. zIndex 分带：mx 弹层 ≤2100，EP 弹层 ≥3000（EP 配置初值 3000）

## 验证

1. `pnpm typecheck`（mindx-work 根）0 错误
2. Playwright 直连 dev 5273（后台 job 勿重启，浏览器 executable 动态探测 `~/Library/Caches/ms-playwright/chromium_headless_shell-*`）：

   * 临时 demo：设置页临时挂 date-picker + table + dialog 各一（**验后移除，不残留冗余 UI**）

   * computed style 断言（注意 `getPropertyValue` 对 var 声明返回字面量，须取元素 computed style）：亮色下 el-button--primary 背景 = rgb(65,118,230)；`theme.setMode('dark')` 后 = rgb(122,170,255)；EP 弹层背景暗色跟随 rgb(44,44,46)（--mx-bg-elevated 暗值）

   * 亮暗双主题截图视觉核对（弹层/表单/浮层各一）
3. 验证通过后移除临时 demo，重跑一次截图确认无残留

## 边界（本次不做）

* 市场动态插件 EP 消费（RenderKit 白名单扩容，未来按需）

* 存量界面/已交付三插件向 EP 迁移（军规定为不迁移）

* unplugin 按需引入（已裁决全量：桌面端体积不敏感，插件零配置写 `<el-*>`）

