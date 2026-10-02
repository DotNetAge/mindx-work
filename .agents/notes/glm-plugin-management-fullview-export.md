# 插件管理全量视图与导出（2026-10-02）

分类：功能/插件体系 ｜ 状态：已完成（typecheck + electron build + app build 通过）

## 任务与用户决策

用户点名五项能力缺口：查看/管理/删除/导出/发布。调研证实前三项（针对在线插件）已存在——设置 → 插件页 MarketManageRow 已有启停/切版/卸载/本地包导入 IPC（UI 未接导入）——用户观感「只有市场」的根源：**「已安装」节只列在线安装的动态插件，23 个预置插件完全不可见**。用户决策（AskUserQuestion 两问）：①全量视图（预置 + 在线同列表，预置标「内置」不可卸载）；②本轮做导出，发布后议（已记 TODO.md）。

## 实施定稿

- **内置目录服务**（`shell.plugin-catalog`）：装配处（app/src/main.ts）是唯一知道插件清单的地方——CORE_PLUGINS 23 条（id/name/description，顺序照装配清单）经 services provide；market store 初始化时 useService 捕获（同 MARKET_RUNTIME_SERVICE 先例：store 首次 use 发生在组件 setup 内 inject 有效，晚于 main.ts 同步 provide）。类型 CorePluginInfo/PLUGIN_CATALOG_SERVICE 定稿在 ui-shell/desktop-bridge.ts（提供方 app 与消费方插件都正向依赖 ui-shell）。
- **导出**（electron/src/plugins.ts）：fflate `zipSync` 打包激活代际目录（collectFiles 递归收集，zip 内路径统一 / 分隔）→ showSaveDialog 挂父窗口（与 install-from-file 对称）→ 默认名 `<id>-<version>.zip`。产物 = manifest.json + 入口 + 资源，与安装包格式一致可重装/分享。IPC `plugins:export` + preload plugins.export + store.exportPlugin（busy 防重 + lastError 通道；成功无弹窗——macOS Finder 心智，对话框消失即完成）。
- **导入入口补全**：preload 的 installFromFile 此前无 UI 消费——市场节头加 package-plus 按钮接 store.importFromFile（「已取消」不报错，其余消息进 lastError）。
- **UI 三节**：内置（pill 标记，无操作钮）→ 已安装（启停/导出 folder-output/卸载）→ 插件市场（导入 + 刷新 + 安装）。

## 关键认知（防后续误判）

- **「已安装」≠「应用全部插件」**：userData/plugins/installed.json 只记在线插件；预置插件是静态 import 编译进 app，无清单无版本号，壳的插件运行时也不持有插件身份（插件 = 函数，注册条目后壳不记「谁注册的」）。全量视图必须由装配处供目录，别往壳内核加「插件身份」机制（过度工程）。
- mindx-market 是内容仓库（agents/skills/mcp + dist 静态产物），市场索引 = 静态托管 index.json（MX_MARKET_INDEX_URL 可 env 覆盖），发布通道 = 条目入仓 + zip 托管 + sha256，无服务端 API——这是发布后议的架构前提。
- 会话「旧数据」排查结论（同日）：mindx-work 任务列表 = daemon `session.list` 实时拉取（store.ts loadSessions），分片存储在**工作目录内** `<project>/.sessions/<agent>/<sessionID>/`（RoutedSessionStore，registry = ~/.mindx/data/session_dirs.json）——app 全新安装读到旧数据不是缓存 bug，是 daemon 侧真实存量（用户历史删除未落在分片上）。

## 消费方式

```ts
// 导出（market store）：成功返回 { ok, path }，主进程弹保存对话框
const r = await store.exportPlugin(view)
// 内置目录（其它插件如需消费）：useService<CorePluginInfo[]>(PLUGIN_CATALOG_SERVICE)
```
