# 插件页可选件 Tab 改版 + mx-plugin 协议失联排障（2026-10-08）

## 需求落地（用户截图批注，一次到位）

1. **插件页 Tab 化**：官方可选件与已安装不再上下堆叠，改为 mx-tabs 分段控件两页签「已安装 / 可选」（与市场页 MarketPaneRow 同款：`[data-indicator]` + JS 写 width/transform 的 syncIndicator，位移补偿容器 padding 4）。文件 `plugins/src/market/prefs/MarketManageRow.vue`。
2. **已安装卡片按批注改**：
   - 卡头副行 `view.id`（反向域 id）→ 换 `view.description`（用户原话「id 毫无意义，换成描述」；缺失回退 id）
   - 信息网格删「指纹」行（shortFp 函数与 .fp 样式一并删）
   - 信息网格加「授权」行（license）
   - 操作行删「导出插件包」按钮（onExport 删；store.exportPlugin 保留为能力 API，notes/glm-plugin-management-fullview-export.md 验收链路仍引用）
3. **数据透传**：InstalledPluginView 增 `description?/license?`（electron plugin-store.ts toView 从激活代际 manifest 读 + ui-shell desktop-bridge.ts 类型镜像 + electron 侧接口镜像）。manifest 契约本就有这两字段，纯展示层透传，无契约变更。

## mx-plugin 协议失联排障（Failed to fetch 四层排除法）

现象：渲染侧一切 `fetch/import('mx-plugin://…')` 裸报 `TypeError: Failed to fetch`；安装落盘成功但激活失败，已安装卡空态。

按层排除的路径（每层一次实验，不叠加猜测）：

1. 卸载后代际目录已删 → fetch 失败合理（误报层，排除）
2. handler 加探针 `console.log` → 主进程日志零命中 → **handler 从未被调用**（注册层问题，锁定）
3. 根因：`protocol.registerSchemesAsPrivileged` **全局只允许调用一次**——plugins.ts（mx-plugin）与 file-stream.ts（mx-file）各自模块顶层声明，后加载者覆盖前者 → mx-plugin 丢特权 → fetch 未进 handler 直接网络层拒绝
4. 修复：main.ts 顶部一次性 `registerSchemesAsPrivileged([...PLUGIN_SCHEMES, ...FILE_STREAM_SCHEMES])`；两模块改为导出 scheme 常量

顺手加固（同一次排障中实证必要）：

- handler 必须 `await net.fetch(...)` 再 return（裸 return 的 rejection 穿透 protocol.handle → 渲染侧网络错误、主进程无日志）
- 响应统一 withCors（standard scheme 受同源策略约束，无 ACAO 一样 Failed to fetch）
- 向导窗 wizard.ts 补 `MX_PROD_DIST` 加载分支（此前只支持 MX_DEV_URL / packaged，本地产物验收链路下向导窗会错误回退 vite dev）

## 可选件样式全没（构建管线丢 CSS，用户发现）

症状：三个可选件装上后界面全裸（类名在、规则不在）。根因：vite 默认把 SFC `<style>` 提取为独立 .css asset，而 build.mjs 的 .mindpkg 打包只携带 `entry.mjs` + manifest——**规则本体整个没进包**（CSS Modules 的类名映射在 JS 里，所以元素有类名但无任何规则定义）。

修复（scripts/optional-plugins/build.mjs）：

- rollupOptions.plugins 加 `inlineCss(meta.id)`：generateBundle 层收割全部 .css asset（delete asset）→ 前插进 entry chunk 顶部（IIFE 建 style 标签注入 head，`data-mx-plugin-style="<id>"` 标记，同 id 旧标签先删再注——重激活/升级幂等单份）
- 自检：构建目录残留 .css asset = 内联失败，直接抛错拒打包（防再次静默丢样式）
- 实证：三包 entry.mjs 均含 `data-mx-plugin-style` 与规则本体（display:flex 12/8/33 处）；真机重装后 Git 图面板（分段胶囊/排版）与 SVG 画板（工具栏/画布/缩放/状态栏）样式完整

教训：**「构建产物自检（fflate 回读 manifest）」只验了清单没验内容完整性**——单文件打包管线的每次产物形态假设（这里假设了「样式会在 entry 里」）都要有产物级断言兜底。

## 流程教训

- **验收 electron 实例用完必须立即杀**：本轮验收实例长期挂后台，其渲染层连真实 daemon 1314，用户实际使用时撞见 WS 403，误判为「改了 daemon 端口」发火。已写入 mindx-work/AGENTS.md（CDP 验证脚本纪律节）。
- daemon 端口 1314 是用户红线：全仓连接语义未动（LOCAL_DAEMON_URL / GATEWAY_PORT / probeDaemonAlive 均原样），报错先核查再回应，结论先行。
