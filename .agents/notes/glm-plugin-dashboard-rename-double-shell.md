# dashboard 插件：kanban→dashboard 改名 + Chrome 130 高度桥塌陷修复（2026-10-02）

## 一、kanban→dashboard 目录与词根改名

用户指令废止了「代码标识符保留 kanban 词根」的旧决定（Kanban 词根让位给将来的任务流看板语义）。

改动面（全部完成，typecheck 通过，CDP 真机验证 dashboard-store 加载 + 详情 tab 正常）：
- `plugins/src/kanban` → `plugins/src/dashboard`（git mv）
- `plugins/src/index.ts`：export 名、DASHBOARD_DETAIL_ID / DASHBOARD_SIDEBAR_SECTION_ID 常量、'dashboard.store'（provide + fileTypes.register）、'dashboard-detail-addchat'
- `plugins/package.json` exports：`"./dashboard": "./src/dashboard/index.ts"`
- `app/src/main.ts`：import 路径 + 装配数组
- 内部标识符：dashboardPlugin / useDashboardStore / DashboardStore·Service·Card·Board / createDashboardService / bindDashboardShell / dashboardsDir / pinia id 'dashboard-store'
- `store.ts` 头注释更新为「2026-10-02 起统一 dashboard 词根」

### 教训（Edit 批量替换）
- 替换有子串包含关系的标识符有顺序依赖：先 `useKanbanStore` 再 `KanbanStore`（否则后者把前者的子串一起换掉产生非法名）。
- `KanbanService` replace_all 会顺带替换 `createKanbanService` 中的子串——替换后 old_string 报 not found 时先怀疑「已经被改好」，用 grep 确认再继续，不要盲目重试。
- 目录改名类任务收尾必须 grep 旧词根全仓库：本次 index.ts 有 2 处漏网（L34 常量使用处、L60 removeToolbar 字符串字面量）全靠 grep 兜住。

## 二、Chrome 130 opaque srcdoc 视口恒 0 → 双层壳修复（存量 bug）

### 症状与根因
- 旧实现：单层 `iframe srcdoc + sandbox="allow-scripts"`，卡内同步 `document.documentElement.scrollHeight` 上报。
- Chrome 130（Electron 33）中 opaque origin 的 srcdoc 文档视口几何恒为 0（innerWidth/scrollHeight 全 0，CDP 实验实证；对照组同源 srcdoc 正常 260/396），且同步首报的 0 之后 ResizeObserver 不再触发修正 → 卡片高度桥全坏。
- 宿主旧钳制是 `h < 0 return`，会收下 0 → cardHeights=0 → iframe 0px → 永远报 0 的死循环。

### 修复（与 mindx-desktop DashboardPane 同构）
- 双层 iframe：外层壳 = 同源 srcdoc（**无 sandbox**，仅固定转发脚本，不含 Agent 内容）；内层 = opaque `sandbox="allow-scripts"`（Agent 内容隔离）。壳转发脚本收 'dash-card-height' 调内层高度（`Math.max(1, Math.min(20000, ...))`）并转发宿主。
- 内层 bridgeScript 改异步多时机上报：`setTimeout 0/80/300` + `load` + ResizeObserver（同步首报时布局未跑必报 0）。
- 宿主 onMessage 0 值拒收（`h <= 0 return`）；`frameHeight` 用 `||` 链（0 值视为无上报）。
- 内层文档经 `escapeHtmlAttr`（& 和 "）转义后作为壳 srcdoc 属性值注入。
- work 无 CSP meta（app/index.html 无、主进程无 onHeadersReceived），壳内联脚本不被拦，无需改 CSP；**desktop 有 CSP，曾因此必须加 'unsafe-inline'，换环境时注意检查**。

### CDP 冒烟结论（Chrome 130 真机）
- 解析/渲染正常：2 卡 iframe、`<board name>` 解析、Detail.show 正常。
- 高度收敛：tokens 卡 224px（3 行内容）稳定；hello 卡 120px 是**正确值**——内容实高 48px < 壳初始高度 120px，内层 scrollHeight = 视口高 120（不是 bug：卡内容矮于初始高度时上报值就是初始高度）。
- 每卡收到 5 次上报（0/80/300ms + load + RO 初始触发），nonce 校验通过。
- 隔离生效的证明方式：宿主侧访问内层 `contentWindow.innerWidth` / `contentDocument` 抛 SecurityError（跨源被拦）——报错即隔离正常。
- 实验脚本：`work-shell-exp2.mjs`（壳带转发脚本 + 内层异步上报）在 Chrome 130 返回 `de:260, iw:596` 通过；此前的 shell-exp 无转发脚本属实验缺陷，消息到不了主文档。

### CDP 技巧
- 探针：`node /private/tmp/cdp-eval.mjs '<js>' --port 9222 --wait <ms>`；长 JS 表达式会被 shell 干扰报 SyntaxError，写 .mjs 脚本文件执行更稳。
- 取 pinia：`document.querySelector("#app").__vue_app__._context.config.globalProperties.$pinia`，`pinia._s.get('dashboard-store')`。
- dev 重启链：`pnpm dev`（Vite 5273）+ `pnpm exec electron . --remote-debugging-port=9222`（**不要带 MX_WIZARD=1，会进向导页**）。git mv 目录后 Vite 模块图失效，必须重启 dev server（页面 reload 救不回）；Vite 已死时页面显示的是死前旧 DOM（pinia 还是旧 id），勿误判代码没生效。
