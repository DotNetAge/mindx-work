# mindx-work 六区契约（完整版）

本文件是 `ui-shell` 内核契约的完整说明，签名与实现一一对应（来源：`ui-shell/src/views.ts` / `createApp.ts` / `services.ts` / `changes.ts` / `registry.ts`）。SKILL.md 只留速查，用到哪个区的细节来这里查。

## 1. 定位与三条硬边界

本契约描述一个构建类 Mac 应用的 UI 框架的组件层：AppShell 的视图区构成、各视图区的条目模型、壳与插件之间的全部接口。界面由预置插件运行时组装而成。

1. **零业务词汇**——框架 API 不出现任何业务概念。换一个业务领域，框架代码零改动。
2. **渲染库无关**——内核对组件类型不透明（`component: unknown`），由薄适配器（ui-shell-vue）收窄类型并负责渲染。
3. **框架不做状态管理**——插件内部状态用所在生态惯用法（本项目定稿：Pinia）；跨插件只有 `services` 一条通道；框架自身只持有视图区条目与机制状态（壳唯一写）。

## 2. 通用条目模型

```ts
// 内核级通用条目，C 由适配器收窄为具体渲染类型（Vue 组件）
interface Entry<C> {
  id: string          // 区内唯一，注册冲突启动期抛错
  order?: number      // 缺省 100，小者在前
  component: C        // 对内核不透明，适配器负责解释与渲染
}

// 图标引用：Iconify 名称 "{collection}:{name}"，如 "lucide:settings"
type Glyph = string

// 壳传给条目组件的 UI 事实（按视图区选用，宁可少传；业务数据不走 props）
interface ViewProps {
  active?: boolean    // Content / Detail：当前是否呈现
  compact?: boolean   // Sidebar：折叠成 rail
}
```

**order 排序语义（九席位通用，实证：`registry.ts` / `views.ts`）**：全部注册表（Sidebar 节 / Header / Footer、Content、Detail、Overlay、Toolbar、Preferences 页 / 行）统一按 order 升序排列，缺省 100，小者在前；同 order 保持注册先后（`Array.prototype.sort` 稳定排序）。例外：Sidebar 节内的行（SidebarRow）无 order 字段，按给定数组顺序渲染。

**order 保留范围（硬约定，违反即错误实现）**：1–1000 为保留值——壳内置条目与预置插件（core）专用；market 在线（扩展）插件注册任何条目必须从 1001 起。该范围是**约定而非运行期校验**（registry 与动态加载器均不做区间拦截，违反不报错），但扩展条目侵入保留段会与未来预置条目抢位，禁止。

各视图区 `entries` 均为**只读快照**：registry 每次返回数组拷贝（`list.slice()`），外部无法改写内部数组，持有旧快照也不受 remove 影响（实证坑：曾返回内部数组本体，remove 换新数组后旧持有者永远读到旧数据且无任何报错——凡 getter 转发必须逐次调用 getter，禁止对象字面量固化 `entries: registry.entries`）。

## 3. Sidebar — 分节导航

行是**数据模型**而非组件，由壳统一渲染。侧栏分三段：Header 固定区（Logo、折叠按钮）、滚动区（节 + 行）、Footer 固定区——Header / Footer 经组件席位注册，不随内容滚动，折叠成 rail 时仍渲染（组件经 `compact` 自适配）。侧栏宽度由壳承载（右缘拖拽手柄调节、双击重置，折叠后禁用拖拽）。

```ts
interface SidebarViewApi<C> {
  add(entry: SidebarEntry<C>): void
  remove(id: string): void
  has(id: string): boolean
  readonly entries: readonly SidebarEntry<C>[]
  addHeader(entry: Entry<C>): void   // 顶部固定区席位
  addFooter(entry: Entry<C>): void   // 底部固定区席位
  readonly headers: readonly Entry<C>[]
  readonly footers: readonly Entry<C>[]
}

type SidebarEntry<C> = Entry<C> & {
  title?: string       // 分节标题，零文案：不传就不渲染节头
  icon?: Glyph         // 折叠成 rail 时的替身
  rows: SidebarRow[]   // 必填；缺 rows 或行缺 id/label 启动期抛错
}

interface SidebarRow<C> {
  id: string            // 必须对应一个 Content 条目 id，启动期校验
  label: string
  icon?: Glyph
  badge?: C             // 可选富元素：未读数、状态点
  variant?: 'button'    // 按钮卡形态（如"新会话"）：动作行不承载选中底
}
```

## 4. Content — 单活动视图

```ts
interface ContentViewApi<C> {
  add(entry: ContentEntry<C>): void   // title 呈现于 Toolbar
  remove(id: string): void            // 移除活动条目后 activeId 回落至 order 最小条目
  has(id: string): boolean
  readonly entries: readonly ContentEntry<C>[]
  readonly activeId: string | null    // 壳唯一写；未选择时 getter 动态回退 order 最小条目（装配期不受注册顺序影响），activate 后固定
  activate(id: string): void          // 仅供壳的 Sidebar 行点击调用；条目不存在抛错
}
```

## 5. Detail — tabs + 轨道

tab 归属解决多插件共存，轨道解决 Content 让位。

```ts
interface DetailViewApi<C> {
  add(entry: DetailEntry<C>): void    // DetailEntry = Entry & { title: string; icon?: Glyph }
  remove(id: string): void
  has(id: string): boolean
  readonly entries: readonly DetailEntry<C>[]
  readonly shown: boolean
  readonly activeTabId: string | null
  show(id?: string): void             // 编程开合，缺省激活首个 tab；条目不存在抛错
  hide(): void
  setActiveTab(id: string): void      // 仅供壳的 tab 点击调用；条目不存在抛错
}
```

## 6. Overlay — 全局浮层

只收全局层；popover / sheet 这类贴着触发点的局部浮层由插件组件自己渲染。

```ts
type OverlayKind = 'modal' | 'banner'

interface OverlayViewApi<C> {
  add(entry: Entry<C> & { kind: OverlayKind }): void
  remove(id: string): void   // 关闭 = 移除
  has(id: string): boolean
  readonly entries: readonly OverlayEntry<C>[]
}
```

- `kind` 非法值抛错。
- **modal 互斥**：已存在 modal 条目时再 add modal 直接抛错（不是静默覆盖）。编排惯例：重复打开同 id 时先 `has(id)` 守卫再 `remove`（`remove` 对不存在条目同样抛错，直接裸 remove 首开即炸）。
- banner 顶部可堆叠，用自增序列号区分 id。

## 7. Toolbar — 窗口工具栏

```ts
interface ToolbarViewApi<C> {
  add(entry: Entry<C> & { slot: 'leading' | 'trailing' }): void  // slot 非法抛错
  remove(id: string): void
  has(id: string): boolean
  readonly entries: readonly ToolbarEntry<C>[]
}
```

两席位全空时整个 Toolbar 不渲染。

## 8. Settings — Preferences

设置面板由壳自动生成，注册者只提供页与行。

```ts
interface PreferencesApi<C> {
  page(entry: PrefPageEntry<C>): void   // PrefPageEntry = Entry & { title: string; icon?: Glyph }
  row(entry: PrefRowEntry<C>): void     // PrefRowEntry = Entry & { page?: string }
  remove(id: string): void              // 先查页再查行；"通用"页不可移除（抛错）
  hasPage(id: string): boolean
  readonly pages: readonly PrefPageEntry<C>[]
  readonly rows: readonly PrefRowEntry<C>[]
  open(): void
  close(): void
  readonly isOpen: boolean
  readonly activePageId: string
  setActivePage(id: string): void       // 页不存在抛错
}
```

- 壳自带"通用"页（id 为 `general`），承接未指定 `page` 的行；该页不可移除，齿轮图标（`lucide:settings`）为其固有视觉。
- 行的 `page` 指向不存在的页 → 启动期校验抛错。

## 9. AppShell 总面

```ts
interface AppShell<C> {
  readonly Sidebar: SidebarViewApi<C>
  readonly Content: ContentViewApi<C>
  readonly Detail:  DetailViewApi<C>
  readonly Overlay: OverlayViewApi<C>
  readonly Toolbar: ToolbarViewApi<C>
  readonly Settings: PreferencesApi<C>
  readonly services: ServiceContext
  readonly version: number            // 结构版本：任何条目 / 机制状态变更后递增
  subscribe(listener: () => void): Unsubscribe
  readonly sidebarCollapsed: boolean  // 壳机制：Sidebar 折叠（壳唯一写）
  toggleSidebar(): void
  dispose(): void                     // 逆序执行全部插件清理函数
}
```

## 10. 服务上下文（跨插件唯一共享通道）

```ts
interface ServiceContext {
  provide(name: string, impl: unknown): void  // 空名 / 同名重复提供抛错
  use<T>(name: string): T                     // 未提供时抛错——依赖缺失在启动期暴露
}
```

通道里流动的是 **Pinia store 等响应式本体**，不是快照副本：提供方放 store，消费方 `useService` 拿到的就是同一份响应式数据（Vue 适配器经 `useService(name)` 取用）。

**调用时机硬边界**：`useService` / `useShell` 基于 Vue inject，**只能在组件 setup 同步上下文调用**——事件回调深处、Pinia store 的 action、setTimeout/async 续体里调用会抛"壳上下文缺失"。需要服务本体的 store：在 store 初始化（setup store 函数体）时捕获一次（首次 `useXxxStore()` 总由某组件 setup 触发，此时 inject 有效），action 里用捕获的引用。

### 10.1 跨插件响应的双形态（MVVM 译法，禁止事件总线）

跨插件联动只有两种合法形态，按语义选型：

| 形态 | 适用语义 | 实现 |
| --- | --- | --- |
| **A. 命令调用** | 消费方对提供方有明确意图（打开/聚焦/执行） | `useService('xx.store')` 调 store 的 **action**（如 `open({ path })`）；提供方在 action 内完成状态写入 + 壳编排（`shell.Detail.show` 等） |
| **B. 状态订阅** | 无方向的同步/多播（状态变了大家都动） | 多方对**同一份 store** 各自 `computed` / `watch`；瞬时事件物化为状态迁移（布尔标志、append 记录、版本号） |

判断口诀：事件总线广播"发生了什么"（无契约）；MVVM 表达"要做什么"（形态 A 的命令）与"现在是什么"（形态 B 的状态）。**不存在第三种**——真需要多对多通知时，是形态 B（同一份事实记录，各方 watch），不是互发消息。

### 10.2 职责规则

- store 归**提供方所有**（定义、类型、字段演进），消费方只调用 action 与读状态，禁止绕过 action 直改对方状态。
- 消费方 `import` 的是提供方的**类型与 store 标识**（或纯字符串 service 名），禁止 import 提供方组件/实现（插件间禁止互相 import 的军规不变）。
- 提供方涉及 Detail 展示时：启动期 `Detail.add` 注册自己的条目，命令 action 内 `Detail.show(id)` 编排打开——打开轨道是提供方的事，消费方只管调命令。

### 10.3 范式：点击文件链接 → 另一插件以 Markdown 显示到 Detail

```ts
// 提供方 md-viewer：store（Model）+ Detail 条目注册 + 命令 action
export const useMdViewerStore = defineStore('md-viewer', () => {
  const currentFile = ref<FileInfo | null>(null)          // 形态 B 的状态本体
  const open = (target: FileInfo) => {                     // 形态 A 的命令
    currentFile.value = target
    useShell().Detail.show(DETAIL_ID)                      // 编排归提供方
  }
  return { currentFile, open }
})
// 插件函数体内：ctx.services.provide('md-viewer', useMdViewerStore())
//              ctx.Detail.add({ id: DETAIL_ID, component: MdViewerPanel, ... })
```

```vue
<!-- 消费方：点击 handler 只有一行命令，不关心对方怎么渲染 -->
<a @click.prevent="useService<ReturnType<typeof useMdViewerStore>>('md-viewer').open(file)">
  {{ file.name }}
</a>
```

渲染联动自动成立：`MdViewerPanel` 内 `computed(() => store.currentFile)` 响应命令写入，零回调、零事件。

### 10.4 内置壳服务（提供方 = app 装配层，类型定稿在 ui-shell/src/desktop-bridge.ts）

| 注册名 | 本体 | 用途 |
| --- | --- | --- |
| `shell.theme` | `ThemeController` | 主题三档（light/dark/auto）：`mode` / `setMode` / `subscribe`；机制归壳，档位持久化也归壳（设置行零感知） |
| `shell.preferences` | `PreferencesController` | **内置设置持久化**：`get(key, fallback)` / `set(key, value)` / `subscribe(key, cb)` / `ready`；落盘 `userData/preferences.json`（主进程原子写 + schemaVersion 代际 + 损坏容错），无宿主桥时降级仅内存。键用 `<owner>.<key>` 前缀防撞（如 `demo.font-size`）；键语义归消费方解释 |
| `shell.market-runtime` | `MarketRuntime` | 在线插件启停控制 |

消费范式（插件设置行持久化）：

```ts
const preferences = useService<PreferencesController>('shell.preferences')
const value = ref(preferences.get('demo.font-size', 14))
void preferences.ready.then(() => { value.value = preferences.get('demo.font-size', value.value) })
// 变更时 preferences.set('demo.font-size', next) —— 立即通知订阅者并异步落盘
```

## 11. 版本通知机制（联动的数据源）

内核是"可变结构 + 版本订阅"，由适配器映射为渲染层响应式：

```ts
interface ChangeHub {
  readonly version: number   // 任何视图区条目 / 壳状态变更后递增
  bump(): void               // version += 1；先复制订阅者再同步投递
  subscribe(listener: () => void): Unsubscribe
}
```

- 全部六区命令 API（add / remove / show / hide / activate / open / close / setActivePage / toggleSidebar…）改完注册表或机制状态后统一 `hub.bump()`。
- **这不是事件总线**：无载荷、无主题、无多播事件语义，只表达"数据变了，重读"。消费方拉模式按需重读，不存在事件时序耦合。
- Vue 适配器薄桥（`ui-shell-vue/src/reactivity.ts`）：
  - `useShell()`：取壳上下文（不在装配组件树内则抛错）；
  - `useShellVersion()`：订阅壳版本，返回响应式版本号；
  - `useShellData(read)`：`computed` 内先 `void version.value` 建立依赖再执行 `read()`——**凡读壳数据（entries / activeId / shown / isOpen / sidebarCollapsed 等）必须经它包裹**，否则界面不随壳变更更新。

## 12. 启动期校验（违反即抛错，装配失败）

| 校验               | 规则                                         |
| ------------------ | -------------------------------------------- |
| 条目 id 唯一       | 同区重复注册同名 id 抛错（registry 层）      |
| Sidebar 行映射     | 行 id 必须能在 Content 条目中找到            |
| Settings 行归属    | 行的 `page` 必须指向已注册的页               |
| Sidebar 条目形状   | 缺 `rows`、行缺 `id` / `label` 抛错          |
| Overlay modal 互斥 | 已有 modal 再 add modal 抛错                 |
| Toolbar slot       | 非 `leading` / `trailing` 抛错               |
| 服务               | 空名 / 重复 provide 抛错；use 未提供服务抛错 |

同一组硬约束经 `validateShellConstraints`（createApp 导出）在**动态插件激活后复调**（§18.1 六区契约对动态插件完全适用）：插件注册完成即校验，违规视为激活失败——执行其清理函数回滚注册后抛错，进失败 banner。禁止只查启动期（动态注册会绕过）。

## 13. 编排语义（关键决策）

1. **导航联动归框架**：Sidebar 行 → Content 条目靠 id 映射，选中态壳唯一持有，插件零连线。
2. **Overlay 收窄**：全局层只有 modal（互斥）与 banner（可叠）；popover / sheet 归插件局部渲染。
3. **Detail 双语义合一**：tab 归属（多插件共存）+ 轨道（Content 让位），`show / hide` 是壳的编排 API。
4. **壳唯一写**：`activeId` / `shown` / `isOpen` / `sidebarCollapsed` 等机制状态的写入点只有壳的编排 API，插件只读（经 `useShellData`）或经命令 API 请求变更。

## 14. 视图区几何速查

壳 = 六区，由 AppFrame 网格组装：

```text
┌─ Sidebar ─┬──────── Content ────────┬─ Detail ─┐
│ 248 / 56  │  （单活动视图，撑满）    │ 320 轨道  │
│  Header   │                         │  tabs    │
│  滚动节    │                         │  轨道体   │
│  Footer   │                         │ (可收起)  │
└───────────┴─────────────────────────┴──────────┘
  Overlay（modal 居中互斥 / banner 顶部可堆叠）与 Settings（大面板）浮于其上
```

- **Sidebar**：展开宽 248 / 折叠 rail 80（容纳 macOS 红绿灯排；右缘拖拽手柄调宽、双击重置，折叠后禁用）；Header/Footer 固定区不随内容滚动；行高梯度：导航行 34 / 节头 36 / 新会话按钮卡 38 / footer 行 42。
- **Content**：单活动视图撑满容器，插件禁止自加 `max-width`。
- **Detail**：右侧轨道，默认 320px、可拖拽调节（240–520，左缘手柄、双击重置，对齐 Sidebar 手柄交互）；打开时自右缘滑入动画，收起时 Content 自动回弹。
- **Settings**：大面板宽 800、高 `min(800px, vh−48)`、圆角 32；左导航 188、页项高 40；右上 28px 圆形关闭钮。
- **Toolbar**：leading/trailing 两席位通栏，全空时整条不渲染。
- **Overlay**：modal 居中互斥、banner 顶部堆叠；卡片壳样式（背景/圆角/min-width/padding/阴影）由壳容器提供，条目组件只写内部排版。

浮层层级定稿（禁改禁猜，改动须同步本表；实证：modal 曾用 50 被设置面板 60 盖住，点击穿透到面板行区）：

| 层 | z-index | 语义 |
| --- | --- | --- |
| Content | 5 | 基准内容层 |
| 拖拽手柄 | 6 | Sidebar/Detail 边缘手柄，须高于 Content dragBand（实证：z-index 1 时顶部 48px 手柄条被 dragBand 盖住无法抓取） |
| banner | 40 | 顶部通知，不阻塞交互 |
| Settings 面板 | 60 | 全屏遮罩大面板 |
| modal | 70 | 互斥阻塞层，必须高于设置面板（面板内确认 modal 的常态） |
| menu | 100 | 下拉菜单，浮于一切常规层 |
| toast | 1100 | 最高瞬时反馈 |

**Esc 分层**（随层级表联动）：Esc 只关最上层——modal 存在时先关 modal（OverlayPane **捕获期**监听 + `stopPropagation`，使设置面板的 Esc 冒泡监听不触发）；无 modal 时 Esc 关设置面板。禁止两层同时响应同一 Esc（实证坑：modal 在前时按 Esc 会同时关掉下层设置面板）。

## 15. 样式与文案纪律

- 主题 token 一律 `--mx-*` 命名空间；亮暗切换归壳；插件组件禁止书写字面色值（细节读 mx-uikit 技能）。
- 零文案壳：壳骨架不含任何文案，标题、按钮文字全部由注册者提供。
- 视图区几何（宽度、让位）由壳计算，条目组件不自算布局边界。

## 16. 契约变更规则

- 新增**可选**字段不破坏契约；删除或改语义需升版本。
- 硬约束不可协商：条目 id 区内唯一、Sidebar 行 id → Content 映射校验、modal 互斥、`--mx-*` token 纪律、零文案壳。

## 17. 数据校验边界（同进程信 TS，边界才校验）

**同进程内信任 TypeScript 静态类型**：类型化调用链（六区 API、services store、组件 props）不加运行时校验、不加回退分支、不为静态接口已保证的值写防御判断——重复校验是噪声，且掩盖真实边界。

**校验只发生在系统边界**（数据从不可信一侧进入之处）：

| 边界 | 校验什么 |
| --- | --- |
| 配置 / 用户输入 | 形状与取值范围；加载时校验并显式报错（§12 启动期校验即此原则的实例） |
| 持久化（文件 / 存储） | 读回时校验版本与形状；未知版本拒绝，不猜测兼容 |
| 跨进程 / 网络 | 结构与来源校验（preload 桥、任何 IPC/远程数据） |
| 插件 service 边界 | `use(name)` 未提供即抛错（启动期暴露）；提供方的 TS 类型就是契约 |

违者的典型症状：对同一个值在两层都写 `if (!x)`；对静态接口承诺的值再跑一遍 `typeof`。

## 18. 动态插件（在线插件 / market）

六区契约对动态插件**完全适用**：入口签名、注册 API、样式军规、id 前缀、清理函数一视同仁。在线插件（market）与预置插件（core）的唯一差异是**可删除性**——机制零分叉。order 取值一条必须遵守：在线插件注册条目 order 一律 ≥ 1001（1–1000 为壳内置与预置插件保留段，§2）。

### 18.1 入口签名与 SDK 注入

```ts
// 动态插件入口（manifest.entry 指向的 ES Module 默认导出）：
export default function (app: AppShell<unknown>, mx: { h: typeof h; MxIcon: typeof MxIcon }): void | (() => void)
```

- 第一参与静态插件完全相同（AppShell 六区 + services）。
- 第二参注入渲染工具（`h` 与 `MxIcon`）：动态插件从 `mx-plugin://` 协议加载，**无 npm import 通道**（无法 import ui-shell-vue），渲染工具由加载器注入补偿。动态插件代码禁止 import 任何工程内模块。
- 卸载语义：market 插件返回的清理函数在启停（`setEnabled`）与卸载时由壳装配层调用。

### 18.2 包格式与 manifest

zip 包 = `manifest.json` + `entry`（.mjs）+ 静态资源（.json / .css / .svg / .png，白名单后缀）。

```jsonc
{
  "id": "com.example.demo",     // 反向域名小写、至少含一个点（身份，安装后不可变）
  "name": "示例插件",            // 展示名
  "version": "1.0.0",           // semver 三段，强制
  "description": "一句话说明",   // 必填非空白
  "author": "作者名",            // 必填
  "url": "https://…",           // 可选，网站
  "repo": "https://…",          // 可选，源码库
  "license": "MIT",             // 必填（SPDX 标识）
  "entry": "entry.mjs",
  "permissions": ["…"],         // 权限告知（给用户看，不构成授权）
  "mxApiVersion": "1"           // 必须等于 ui-shell 导出的 MX_API_VERSION
}
```

- manifest 语义校验唯一家 = `ui-shell` 导出的 `manifestIssues(value): string[]`（收集全部问题一次性返回）；安装与加载前都调用它。
- 主进程只做**机械校验**（id/version 字符格式、entry 存在、zip 内路径不越界、后缀白名单）防路径穿越——§17 边界分工：渲染侧管语义，主进程管机械，两层各自完整，不互代。

### 18.3 版本代际与安装目录

- **id 是身份，version 是不可变代际，activeVersion 是激活指针**。更新 = 落新代际目录 + 指针迁移；回滚 = 切回旧指针（旧代际原样保留）；卸载才删该 id 全部版本目录。
- 安装目录 `userData/plugins/<id>/<version>/`（两层缺一不可：一层装不下多代际并存）；状态文件 `installed.json`（`schemaVersion: 1`；`plugins: [{ id, name, enabled, activeVersion, versions: [{ version, sha256, installedAt }] }]`）。
- `installed.json` 是状态文件，受持久化代际纪律约束（未知 `schemaVersion` 拒绝，不猜测兼容）；版本目录属程序资源，同版本重装允许覆盖。
- 协议 URL `mx-plugin://<id>/<version>/<file>` 锁定具体代际，指针切换后重新拉取即加载新代际。
- **多代际的安装入口**：市场卡在"该插件还有未安装版本"时保持可装（文案"安装此版本"），全部版本已装才禁用——否则多代际永远只有安装日的那一个，切版 UI 无从呈现。确认安装前必须先 `runtime.deactivate(id)`：activate 对已激活插件幂等返回，直接装新代际再 activate 会因幂等跳过而继续跑旧代际（实证坑）。

### 18.4 加载通道：mx-plugin:// 特权协议

- Chromium 禁止 http/file origin 动态 import file:// 资源（实证）→ 定稿特权协议 `mx-plugin://<id>/<version>/<file>`（host = id，路径首段 = version，与安装目录同构）；dev 与产物统一走协议，无环境分叉。
- `protocol.registerSchemesAsPrivileged` **必须在 app.ready 之前调用**（模块顶层）——app.ready 后调用静默无效。
- 协议 handler 机械校验：id/version 格式 + resolve 后仍在安装根内 + 后缀白名单，再回读版本目录文件（`net.fetch(pathToFileURL(…))`）。

### 18.5 IPC 桥与渲染侧加载器

- preload 暴露 `window.mxDesktop.plugins`：`list` / `installFromFile` / `installFromUrl` / `uninstall` / `setEnabled` / `setActiveVersion`；主进程 handler 全部校验 `BrowserWindow.fromWebContents(event.sender)`。
- app 装配期 `loadMarketPlugins(app)`（mount 前异步执行）：逐个 enabled 插件 fetch manifest → `manifestIssues` 校验 → 目录身份一致性（`manifest.id === view.id`）→ `import(/* @vite-ignore */ mx-plugin://…)` → `mod.default(app, { h, MxIcon })` → **`validateShellConstraints` 激活期复调**（违规 = 清理回滚 + 激活失败，§12）。
- **动态 import 同一 specifier 只求值一次**（ES module 语义）：停用→再启用、切版往返、卸载重装都会命中模块缓存，入口函数不再执行、注册不发生（实证坑）。每次激活必须给 import URL 加唯一 query（如 `?activate=<递增序号>`）穿透缓存；协议 handler 按 `new URL().pathname` 解析，query 不参与路径匹配，安全。
- **运行期启停与 Content 活动指针**：停用移除活动条目时 Content 回退到 order 最小条目；重新激活后条目恢复注册但活动指针**不自动跳转**（壳契约：activeId 由 Sidebar 行点击唯一写）。market 插件启停不得自动切页——用户在设置面板内操作，背景页跳转是惊扰；页面恢复由用户再点行完成。
- 失败隔离：单个插件激活失败收集为 `MarketLoadFailure`，装配完成后以 banner 呈现（Overlay.add 纯内容组件），**不挡首帧**。
- 纯 Web 环境（`window.mxDesktop` 不存在）加载器直接返回空——market 机制是 Electron 宿主能力。

### 18.6 市场源（静态托管）与信任模型

- 市场服务器形态 = **静态托管**：`index.json`（多版本数组 `versions: […]`）+ zip 包，主进程 `market:list` 拉取、`market:install` 下载 zip 走同一安装管线（sha256 + 代际落盘 + 指针迁移）。放弃了动态注册中心：无服务端状态、可 CDN 化、离线可缓存。
- 信任模型 = **显式安装即信任**（对齐 DSH"面板手势免审批"分级）：安装确认 UI 必须完整呈现 author / url / repo / license / permissions / versions，用户确认后落盘；安装时 sha256 校验完整性。放弃了 node:vm 沙箱隔离：桌面端安装即本机手势，与 core 插件同权。
