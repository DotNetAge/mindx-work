---
name: mx-plugin-dev
description: mindx-work 插件开发技能。当为 mindx-work 编写新插件、给界面新增页面/侧栏节/设置页/浮层/详情轨道、或需要查六区契约 API 与界面构成时使用，涵盖军规、场景化脚手架用法、契约索引与开发规范。
---

# mindx-work 插件开发技能

## 何时使用

- 为 mindx-work 写新插件（`plugins/` 下新增插件模块）。
- 在现有插件里加页面、侧栏节、设置页、浮层、详情轨道、工具栏席位。
- 分流出口：规格未定的新插件（缺席位清单 / 交互编排）→ 先走 mx-plugin-design 技能收规格，回本技能施工。

本技能是**军规 + 快速索引**；实现细节按下表取用，不在本文件重复：

| 需求                                                                                 | 去处                                                                        |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 按场景生成插件骨架（basic / detail / settings / overlay / services）                 | `scripts/scaffold_plugin.py`，场景用法与机制依据读 `references/examples.md` |
| 六区契约全 API 签名、版本通知机制、启动期校验、编排语义、视图区几何                  | `references/contract.md`                                                    |
| 跨插件响应/联动（另一插件对某动作或状态变化做出反应）                                | `references/contract.md` §10（双形态选型 + 职责规则 + Detail 范式）         |
| 在线插件（market）：包格式 / manifest 字段 / 版本代际 / mx-plugin:// 协议 / 市场安装 | `references/contract.md` §18                                                |
| 样式与控件（token、原语、伪类、色彩/字体/布局三大规范）                              | mx-uikit 技能                                                               |
| 工程装配（五包依赖、主题、mount）                                                    | `mindx-work/docs/界面层选型.md`                                             |

## 军规（违反任何一条都是错误实现）

1. **样式与界面开发必须严格使用 mx-uikit 技能**：token、控件原语、色彩/字体/布局规范一律从 mx-uikit 取；禁止自造样式、字面色值、页内 style。
2. **MVVM，禁事件总线**：界面状态与联动一律 MVVM，EventEmitter / mitt / 自造 pub-sub 不得出现。两条链路：壳机制联动 = 命令 API + ChangeHub 版本通知（拉模式，无载荷无主题，壳不提供任何事件出口）；插件内部状态 = Pinia store + SFC 声明式绑定。机制细节读 `references/contract.md`。
3. **读壳状态必须经 `useShellData` 包裹**：直接读 `shell.xxx` 是裸值，界面不随壳变更更新。
4. **联动只走既有通路**：导航归壳（行点击切页零连线）、跨区编排走命令 API（`Detail.show` / `Overlay.add` 等）、跨插件共享走 services（流动的是 Pinia store 响应式本体）、业务数据放自己的 store；插件间禁止 import。
5. **条目 id 区内唯一且带插件前缀**（防跨插件撞 id，重复注册装配期抛错）；Sidebar 行 id 必须对应 Content 条目 id。**order 保留范围**：1–1000 为壳内置与预置插件保留值，market 在线（扩展）插件必须从 1001 起。
6. **壳机制状态壳唯一写**（`activeId` / `shown` / `isOpen` / `sidebarCollapsed`）：插件只读（经 `useShellData`）或经命令 API 请求变更。
7. **Overlay 条目组件是纯内容组件**：壳不传 props，banner 关闭钮与 modal/banner 卡片壳样式由壳容器提供。
8. **注册的资源返回清理函数**；代码注释一律中文。
9. **禁止猜测 API**：写法先查 `references/contract.md`（契约）与 `references/examples.md`（场景），有代码依据才落笔。

## 插件目录组织

插件是 `plugins/src/<name>/` 模块（demo 为范式，骨架由脚手架生成）：

```text
plugins/src/<name>/
├── index.ts          # 插件入口：全部注册在此（包 exports 与 re-export 唯一指向）
├── store.ts          # Pinia store：插件业务状态与配置项（Model）
├── ids.ts            # 跨文件共享的 id / 常量（条目 id、浮层 id；单文件用时可内联）
├── pages/            # Content 页面组件（与 Content.add 一一对应）
├── sidebar/          # Sidebar Header / Footer 席位组件
├── prefs/            # 设置行 / 设置页组件（Settings.page / Settings.row）
├── overlays/         # 浮层内容组件（modal / banner，纯内容组件）
├── assets/           # 插件静态资源（logo 等仓库级资源不放这）
└── <Name>.vue        # Detail tab / 行 badge 等单一注册位组件（量少时平铺模块根）
```

放置规则：**按注册席位归属**——每个目录对应一类 `ctx` 注册调用；Detail tab、badge 这类单一组件平铺模块根（demo 实证：`SessionDetail.vue`、`UnreadBadge.vue`）；同一 id 多处使用（页面 + Overlay）必须进 `ids.ts`。

资产引用实证坑：`import.meta.glob` 的匹配路径**相对当前模块文件**解析（非包根 / src），不匹配时 Vite **静默返回空 map、无任何报错**，调用方再有兜底分支（如首字母占位）则缺陷双重隐身（实证：models/providerIcons.ts 写 `../assets/` 而模块位于包根，品牌图标全部静默落入兜底）。glob 路径必须以引用方文件为原点核对；验收必须断言资源渲染本体，且 dev 下小体积 SVG 经 `?url` 导入会被 Vite 内联为 `data:` URI——按 src 路径关键字写的选择器在 dev 会失配。

项目级目录地图（壳/适配器/装配各放哪）读 mx-dev-guide 技能。

## 开发流程

1. 按场景生成骨架（mindx-work 根目录执行；场景可任意叠加，不带 `--with` 即 basic）：

   ```bash
   python3 ../.skills/mx-plugin-dev/scripts/scaffold_plugin.py my-plugin --with detail settings
   ```

   脚本自动完成三处注册：`plugins/package.json` exports 子路径、`plugins/src/index.ts` re-export、`app/src/main.ts` 装配清单；锚点不匹配时跳过并提示手工步骤。
2. 按需填充业务逻辑：骨架注释即范式注释；样式严格用 mx-uikit；图标一律 `<MxIcon name="lucide:xxx" :size="16 或 20" />`。
3. 每轮验证（mindx-work 目录）：`pnpm typecheck`（vue-tsc 校验 SFC + TS）+ Python Playwright 断言（浏览器二进制经 `launch(executable_path=...)` 指向本机已缓存版本，勿硬编码版本号）：断言渲染、交互与 0 页面错误，截图确认。禁止猜测。普通插件走 dev 5273；**market/动态插件走真机验收链路**（构建产物 + env + CDP，读 mx-dev-guide → references/architecture.md §7"真机验收链路"）。

   **Playwright 判据军规**（每条都是实踩教训，违反即断言不可信）：
   - 多元素断言一律 `count()` 判定，严禁裸 `get_by_text(...).is_visible()`——命中多元素抛 strict violation、单元素不可见返回 False，两种失败形态都会把脚本带进错误方向。
   - 设置面板是全屏遮罩：面板开着时点不到 Sidebar/Content（点击超时不是 bug）；且面板内"已安装列表"文本与 Sidebar 行文本同名——**判定 Sidebar 行必须用 `span[class*="rowLabel"]` 类名定位**，文本定位会被面板内同名文本污染。
   - 面板/浮层操作后用 Esc 收起再操作底层视图；验收脚本必须幂等开局（残留 modal 先取消、`navTitle` 判据补开面板、遗留安装先卸载还原）——脚本会反复重跑与中断续跑。
   - `wait_for_selector` 默认 `state='visible'`；被遮挡元素 visible 仍为 True（遮挡不影响几何判定），文本"存在但没渲染"要用 DOM count 而非可见性断言。
