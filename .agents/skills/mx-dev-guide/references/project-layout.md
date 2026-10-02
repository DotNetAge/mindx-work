# mindx-work 项目目录说明

仓库全部源文件的目录地图（实证清单）。改前先看"新代码放哪"；契约与样式细节不在此重复——按文末引用去对应技能加载。

## 仓库根

```text
mindx-work/
├── package.json          # workspace 根脚本：dev / build / typecheck（vue-tsc）
├── tsconfig.base.json    # 共享 TS 基配置（strict）
├── assets/               # 仓库级静态资源：logo 三版本（mindx-color / -mono / -white.svg）
├── docs/                 # 定稿文档：组件层契约、界面层选型、界面军规、样式原语
├── ui-shell/             # 内核包（零 Vue 依赖）
├── ui-shell-vue/         # Vue 适配器包
├── plugins/              # 插件包（单包多模块）
├── app/                  # 装配入口包
└── electron/             # 窗口壳包（薄）
```

## ui-shell/src —— 内核（渲染无关）

| 文件 | 职责 |
| --- | --- |
| `types.ts` | 通用类型：Entry / ViewProps / Unsubscribe 等 |
| `registry.ts` | 条目注册表：add/remove/has/entries，id 冲突抛错 |
| `views.ts` | 八区 API 定稿（Sidebar/Content/Detail/Overlay/Sheet/Floater/Toolbar/Preferences 的全签名与校验） |
| `changes.ts` | ChangeHub：版本递增 + 订阅（联动的通知源，非事件总线） |
| `services.ts` | ServiceContext：provide / use（重复提供、缺失消费抛错） |
| `createApp.ts` | AppShell 总面组装 + 启动期校验（行 id→Content 映射、Settings 行归属）+ dispose |
| `index.ts` | 包导出面 |

## ui-shell-vue/src —— Vue 适配器

| 文件 | 职责 |
| --- | --- |
| `components/AppFrame.vue` | 壳骨架网格：八区组装、拖动带、让位 |
| `components/` 其余八件 | 各区渲染：SidebarPane（行点击→activate）/ ContentPane（v-if 单活动）/ DetailPane / OverlayPane（modal+banner 容器）/ SheetPane（全屏抽层容器）/ FloaterPane（可拖动浮窗容器）/ ToolbarPane / SettingsPane |
| `MxIcon.vue` | 图标原语（Iconify 名称，单色 currentColor，16/20 两档） |
| `reactivity.ts` | 薄桥：`useShell` / `useShellVersion` / `useShellData` / `useService` + SHELL_KEY |
| `theme.ts` | 主题控制器（light/dark/auto，token 切换） |
| `mountVueApp.ts` | 挂载：provide 壳上下文 + `app.use(createPinia())` |
| `styles/tokens.css` | `--mx-*` token 定稿（唯一权威之一） |
| `styles/controls.css` | 基础控件原语样式（mx-btn / mx-input 等） |
| `index.ts` | 包导出面（插件唯一允许的依赖入口） |

## plugins/ —— 插件包

```text
plugins/
├── package.json          # 单包多模块：exports 有 "." 与 "./demo" 等子路径
├── tsconfig.json
└── src/
    ├── index.ts          # 包根：re-export 各插件
    ├── vue-shim.d.ts     # SFC 类型垫片
    └── demo/             # 预置插件（范式，插件内部组织读 mx-plugin-dev 技能）
```

新增插件 = 新建 `src/<name>/` 模块 + 三处注册（脚手架自动完成，读 mx-plugin-dev）。

## app/ —— 装配入口

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | `createApp([插件清单])` → services.provide → `mountVueApp`；主题初始化 |
| `index.html` | 挂载点 |
| `vite.config.ts` | dev 端口 5273 |
| `src/env.d.ts` | 环境类型 |

## electron/ —— 窗口壳

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | 主进程：窗口生命周期、macOS vibrancy、系统驻留图标（托盘）与关窗驻留、原生主题桥；零业务 |
| `src/preload.ts` | 预加载：窗口级能力（平台标记、主题偏好发布桥） |
| `electron-builder.yml` | 打包配置（main 入口 / extraResources 装载前端产物与托盘图标 / 签名公证）——细节见 mx-release 技能 |

## resources/ —— 打包资源（electron-builder 引用）

| 文件/目录 | 职责 |
| --- | --- |
| `icon.png` | 应用主图标（1024 透明底，出自 `assets/mindx-mono.svg` 黑版——彩色版归 mindx-desktop） |
| `tray/` | 系统驻留图标：`iconTemplate(.png/@2x)` macOS 模板图、`icon.png` Windows 彩色图 |
| `entitlements.mac.plist` | macOS 公证所需 entitlements |

## 新代码放哪

| 要加什么 | 放哪 |
| --- | --- |
| 新插件 / 插件内页面、组件 | `plugins/src/<name>/`（mx-plugin-dev 生成） |
| 插件静态资源 | 插件模块内 `assets/`（仓库级资源才进根 `assets/`） |
| 八区 API / 校验 / 内核机制 | `ui-shell/src`（改动 → 同步 mx-plugin-dev 契约） |
| 渲染组件 / 薄桥 / 样式原语 | `ui-shell-vue/src`（样式改动 → 同步 mx-uikit） |
| 窗口 / 系统能力 | `electron/src`（禁止业务逻辑） |
| 架构定稿文档 | `docs/` + 本技能 references 同步 |

## 引用（细节不在此重复）

- 八区契约 / 插件机制：mx-plugin-dev 技能（references/contract.md）
- 样式与控件：mx-uikit 技能
- 选型决策与运行链路：本技能 references/architecture.md
