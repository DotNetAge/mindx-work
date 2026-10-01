# 动态看板插件（kanban）设计定稿 —— Agent-Driven UI

> 2026-09-30 讨论定稿，来源：TODO.md「动态看板」条目 + 用户三项拍板。
> 状态：已实施，且经两次架构修正（见文末「架构转向定稿」，八类注册表方案已废弃）。

## 使命定位

给 Agent 第三种输出形态（对话、产物之外）：**结构化工作台**。Agent 按技能约定写数据文件（*.kanban 布局 + data/*.json 数据）= 构建/更新用户界面；用户在看板中与 Agent 继续对话。核心心智：「看板是 Agent 的实时仪表盘」。

## 用户拍板的三项决策

1. **Widget 供给 = 预置注册表，纯数据驱动**。Agent 只写 `type + props + dataRef`，永远不写 Vue 代码；startScript 降为 v2 可选增强钩子（挂载后受限执行的函数体，注入 data）。
2. **席位 = Detail 轨道**（用户原话要点：Detail 扩展能力强同样可满屏宽；Content 大数时间被 chatflow 占据，看板放 Detail 用户可一边对话一边看 Agent 更新看板——对话与看板同屏共生）。openMax 支持铺满。Sidebar 需看板列表入口（列出当前工作区 .agents/kanbans/ 全部文件；入口形态 Sidebar 区还是 Toolbar 全局图标——实施时定）。
3. **v1 Widget 范围 = 全选八类**：统计卡、列表、表格、进度（数据面板四件套，纯 EP 组件）；看板列（分组卡片列，静态展示）；甘特图（SVG 简版，零依赖自绘）；Markdown 卡、iframe 卡。

## 文件协议

```
<工作区>/.agents/kanbans/
├── bugs.kanban          # 布局 JSON（稳定）
├── gantt.kanban
└── data/                # 数据 JSON（常变，Agent 只改这里）
    └── bugs.json
```

- `*.kanban` 结构：`{ name, layout: { gap, ... }, widgets: [{ id, type, span(占几栏/24), h?, title?, props, dataRef? }] }`
- **Layout 属性（用户补充）**：widget 占多少列（span）、Gap 大小等以属性定义，看板按 24 栏栅格自动渲染
- 数据引用：widget 经 dataRef 指向 data/*.json（布局数据分离——Agent 补数据不动布局）

## 刷新与联动（全部复用现有机制）

- **刷新**：file_modified 事件（daemon 已有，handleFileModified 先例）命中 .agents/kanbans/ 目录 → 重载对应看板。Agent 写完即生效，无轮询。
- **反向联动**：Widget 条目「添加到对话」复用 chatflow appendFileRef 引用 chip 通道（五个查看器已验证的范式），用户指数据让 Agent 深入分析。
- **技能**：随插件写 SKILL.md 教 Agent 看板 schema、目录约定与生成流程（Agent 侧面向看板文件，进入目录即知可加载 .agents/kanbans/）。

## 实施接线参照（范式齐备）

- 插件三件套范式：glm-plugin-docpreview-viewer-pattern.md
- Detail 席位 + DetailToolbar owner 按钮：五个查看器先例（addToolbar 带 owner）
- fs RPC：fs.read_base64 / fs.list（chatflow openFile 路由先例）
- *.kanban 文件打开路由：chatflow openFile + explorer TreeNode 两处接线（VIDEO/SVGBOARD 先例），路由到看板插件

## Widget 能力供给 = Skill（2026-09-30 用户修正）

不做 Widget 市场/二级插件体系。Widget 能力来源是 Skill：注册表是渲染白名单（type + props + dataRef 的合法组合空间），Skill 是知识供给——提供一堆 Skill 教 Agent「现做」各领域看板（组合现有类型 + 数据协议）。要新形态 = 写新 Skill（或扩注册表），永不引入市场/动态代码机制。

## v2 明确延后

startScript 钩子；看板列拖卡流转；甘特拖拽改期；可视化布局编辑器（v1 用户不满意让 Agent 改，不做拖拽 grid-stack）。

## 复杂度红线（防过度工程）

- Agent 永不写代码（注册表 type 白名单之外的一律拒绝渲染并提示）
- v1 不做拖拽、不做编辑器、不做动态编译
- 甘特图零依赖 SVG 自绘（svgboard 先例），不引 echarts

---

## 架构转向定稿（2026-09-30 第二次修正，用户拍板）

第一版实施（八类注册表 + dataRef 数据文件）与用户心智冲突，用户纠偏：

1. **「你实现的 widget 只有 iframeWidget 是有用的」**——预置类型是替 Agent 预设能力，与 Agent-Driven UI 相悖；真正让 Agent 驱动 UI = Agent 直接写静态网页，嵌入即 Widget。
2. **「看板文件做成 XML，可以在看板中直接写 HTML」**——布局与内容同文件，无需外部数据文件/dataRef/文件通道。
3. 多样性来源 = 技能（不同 Widget 形态走不同 Skill 或带多模板的综合 Skill），不是注册表。「架构越简单效果越不简单」。

### 定稿协议（单文件 HTML 方言）

- `.agents/kanbans/<名字>.kanban` 单文件：`<board name gap>` 根 + `<card id span h title>` 子节点，**卡内任意 HTML/CSS/JS 即卡片本体**。
- 解析 = `DOMParser('text/html')` 宽容解析（自定义标签；未闭合/裸 `&` 不炸；不采用严格 XML——HTML 写法会炸，CDATA 易错）。
- 渲染 = 每卡 `iframe srcdoc` + `sandbox="allow-scripts"`（无同源权限，不污染主应用）；srcdoc 注入主题基底（字体 + 主文档 token 文字色）。
- 高度自适应 = 卡内 ResizeObserver postMessage 上报，宿主 nonce 校验后跟随（srcdoc 不含高度依赖，无重载循环）。
- 刷新 = tool_exec_end/loop_end 400ms trailing 合并重读重解析（沿用第一版结论）；未变卡片 srcdoc 字符串相等不重载。
- CSP 实证：全仓无 Content-Security-Policy 声明，srcdoc 内联脚本可用（srcdoc 继承父 CSP，若未来加 CSP 需放行）。
- 已删除：八类 Widget 组件、tone.ts、common.ts、dataRef/data 装载逻辑、示例 data/*.json。

### 实施坑（新增）

- **SFC 模板字符串含 `<script>`/`</script>` 字面量会切断顶层 script 块**（@vue/compiler-sfc 按标签切块不感知 JS 语法）：srcdoc 桥脚本必须拆串（`'<scr' + 'ipt>'`）。表现为 vue-tsc 报「no default export」+ 内部导入全部 unused。

## 技能族场景化定稿（2026-09-30 第三次修正，用户拍板）

### 转向原因（用户原话要点）

第一版按**卡型**拆应用技能（kanban-metrics/flow/table/timeline/report），用户否定：「kanban-table、kanban-flow 这样的技能到底是干嘛的？」——用户心智是**强业务场景**：「我要创建一个项目跟踪看板、人力资源看板、BUG 管理看板、架构看板（Archify 植入看板），一看就知道是干嘛的，会用到些什么控件」。技能命名要业务语义，不要控件语义。

### 技能族定稿（5 个，mindx-work/.agents/skills/）

- `kanban-spec`：前置规范（唯一必读）。单文件协议、board/card 属性数据格式与意义、沙箱基底环境、红线、场景路由表、生成流程。
- `kanban-project` 项目跟踪：迭代 stat 行、进度+里程碑刻度、任务流转列、垂直里程碑时间线、风险清单。
- `kanban-hr` 人力资源：团队 stat 行、部门条形分布、招聘漏斗、成员卡片墙（头像圆点+状态点）。
- `kanban-bug` 缺陷管理：缺陷 stat 行、ECharts 七日双线趋势、严重级分布（P0 红/P1 橙/P2 蓝/P3 绿全板一致）、流转列、明细表。
- `kanban-arch` 架构：Archify 产物植入大卡（span24 + h420~560）、手写分层拓扑、服务清单表、健康度 stat、技术栈分布。
- kanban-ui 已删除（协议并入 spec，模板并入各场景技能）。

### 设计准则

- 每个场景技能**自包含整套模板**（卡片构成表 + 完整可复制模板 + 业务字段场景化 + 生成要点），Agent 读 spec + 一个场景技能即可产出整板，不用跨技能拼装。
- 每个应用技能 frontmatter description 与正文第 0 步都强制声明「使用前必须先读 kanban-spec」。
- 场景不匹配的自定义领域看板：spec 路由表注明可参照场景技能的通用控件骨架自由组合。

### 关键实证：Archify 产物整段植入的解析行为

kanban-arch 声称「产物含 `<html>/<head>/<body>` 包裹整段粘贴进 card 时，`<style>/<script>/<link>` 与 body 内容保留」。已用 jsdom 24（内部 parse5，符合 HTML5 规范，与浏览器 DOMParser 行为一致）实测三个用例：

- 片段植入（style+div+script 无包裹）：style/script 全保留。
- **整段植入（含 DOCTYPE/html/head/style/meta/link/body 包裹）：style、script、link、body 内容全部保留在 card.innerHTML 内**，html/head/body 标签被解析器剥离，meta 也残留（冗余无害）。
- 常规卡回归：不受影响。

结论：Agent 把 archify 产物 HTML 整段粘进 `<card>` 即可，无需手工剥壳；产物超约 500KB 时改走手写拓扑或摘取核心 SVG。

### 技能编写教训（用户纠正，最强信号）

转向场景技能时 kanban-spec 的 **description 残留旧卡型技能名（metrics/flow/table/timeline/report）**——这些技能在技能目录不存在，Agent 读到会被引导去找幽灵技能，技能系统直接失效。用户怒斥「技能内怎么能声明超出技能目录的其它的目录」。修复与纪律：

1. **改技能族结构时，description 必须同步重写**——description 是 Agent 的技能路由依据，引用不存在的技能名等于给 Agent 指死路。正文与 description 要分开自查。
2. 技能内禁止引用技能目录之外的具体文件路径（如示例看板 `.agents/kanbans/bugs.kanban`——文件在别的目录，任何其它工作区都不存在）。已删除该引用。
3. 保留 `.agents/kanbans/` 目录约定（kanban-spec 生成流程）：这不是跨目录引用，而是看板插件的协议输出目录——store.ts `kanbansDir = currentProjectDir + '/.agents/kanbans'` 硬编码，技能必须告诉 Agent 文件写到哪，否则技能无法工作。
4. 交叉引用自检法：Grep 技能目录全部 `kanban-[a-z]+`，逐一核对每个名字都有真实存在的技能目录。

## 技能写法方法论定稿（2026-09-30 第四次修正，用户拍板）

### 转向原因（用户原话要点，技能写法）

第一版场景技能把大量 HTML 模板直接写进 SKILL.md，用户否定：「这样写 Agent 就不会发挥创意会直接抄你的代码！」正确的技能结构：**何时用、怎么用、工作流程、范例引用、脚本**。SKILL.md 是引导（如何写、注意什么、怎么布局、显示什么内容），大量 HTML 归 `references/`，模板化输出用 Python 脚本节省上下文。

用户的布局设计语言示例（项目跟踪看板）：看板用户是项目管理相关人员 → 左右两个垂直大通栏：左栏全局甘特图，右栏自上而下布局多个小部件（人员组成、达成目标、延期事项）。「这样写 Agent 才会根据它当时与用户对话的场景根据这份『引导』去思考与工作，而不是给出源代码。」

### 技能结构定稿

- `kanban-spec/SKILL.md`：何时用、工作流程（场景分析→布局设计→取数→生成二选一→落盘）、协议、环境、红线、场景路由、资源索引（按需读取，勿整读）。
- `kanban-spec/references/card-cookbook.md`：标准控件写法手册（stat/progress/bars/funnel/flow/table/timeline/gantt/members/echarts + 设计新控件指引）——手写时才读。
- `kanban-spec/scripts/new_board.py`：模板化输出脚本，内建 10 种控件渲染器；Agent 写 spec JSON（数据+结构）→ 脚本产出 .kanban（已实测 10 卡全渲染，含 gantt today 线/语义色/栅格定位）。
- 四个场景技能 `SKILL.md` 统一结构：**第 0 步读 spec → 这个看板给谁看（用户画像+四个关心问题）→ 布局设计语言（版式起点+变体引导，明说「不是死规定」）→ 部件内容引导表（显示什么/注意什么）→ 工作流程 → 范例引用**；完整示例看板移至各自 `references/example.kanban`。
- 项目跟踪版式按用户示例落地：左栏 10/24 全局甘特通栏 + 右栏 14/24 自上而下（达成目标→人员负载→延期事项）。

### 教训

技能 = 引导 + 渐进披露（references/scripts），不是代码堆放处。写技能先问：Agent 读完能「思考与工作」还是只会「抄」？

## 样式规范定稿（2026-09-30 第五次修正，用户拍板）

### 转向原因（用户原话要点，样式）

用户打开 demo 看板后否定样式：「看板的样式基本上都是写死样式，尤其字体颜色、状态数字是重灾区，Agent 貌似并不会优先考虑使用 UIKit 的规范，其次应该考虑使用 EP 的设计规范，而不应该写死样式」。同轮补充协议要求：board 增加 `<style>` 元素与 class，card 增加 class。

### 根因（两层，都在宿主与规范侧）

1. **沙箱隔离**：卡是独立 iframe srcdoc，宿主只注入 `--mx-text` 单值，卡内 `var(--mx-success)` 等全是空值——Agent 想用 token 也没法用。
2. **规范教错了**：kanban-spec「基底环境」明文教「语义强调色用固定色值配低透明底」，new_board.py 的 TONES 色板（#12b76a 等）与 cookbook 范例全输出写死 hex。Agent 是照规范干的，规范本身错了。

### 定稿三层

- **宿主注入 token 快照**（DetailPanel.vue）：`collectTokenCss()` 按显式 token 清单逐名取宿主计算值拼 `:root` 块注入每卡（注意：**不能**用 computed style 枚举自定义属性，Electron 33 实测拿不到——见第六次修正；落空保底 `--mx-text`）；`MutationObserver` 监听 `data-mx-theme` 即时重取 → 全卡重载跟随。EP 变量不注入——宿主 element-plus.css 本就把 `--el-*` 桥接为 `--mx-*` 派生，卡内 EP 色阶用 `color-mix` 自派生。
- **协议扩展**（store.ts）：board + `class`（注入每卡 body）、+ `<style>` 直接子元素（board 级共享样式，注入每卡 head，卡内样式靠后可覆盖）；card + `class`（注入该卡 body，与 board class 合并）。
- **技能与工具链**：kanban-spec 增「设计规范」完整章节（颜色 token 表 / 文字与部件观感 / 图表 / 共享样式 / 红线纪律）；四个场景技能统一补「样式纪律（全板一致）」小节 + 本场景语义色映射表（bug 的 P0..P3 固定映射、project 的进行中/延期/阻塞、hr 的在岗/忙碌、arch 的正常/告警/故障），第 0 步强制声明读「设计规范」；new_board.py TONES→token、部件公共样式统一提升 board 级 `BOARD_CSS`（w-* 前缀类，gantt 实例相关栅格列数留卡内）；card-cookbook 与 4 个场景 example.kanban 全部 token 化去重（子代理执行，63 处清零）。用户追加要求「spec 本身就要有设计规范说明、全系列看板技能都要符合设计规范」——落点：规范在 spec 成章、场景技能语义色映射收口、范例与脚本输出天然合规。

### 教训（样式规范）

「Agent 不写死样式」不能靠要求，要做成唯一可行路径：宿主给能力（token 注入）+ 技能给纪律（规范表 + 红线）+ 工具链给默认（脚本输出天然合规）。把写死色写进规范 = 教 Agent 违反主题原则。验证 harness 复刻要点：主题切换必须挂 `data-mx-theme` 在 documentElement 上（枚举才拿得到暗色值），token 快照变化要触发全卡重载。

## token 注入失效实证修复（2026-09-30 第六次修正）

### 现象与用户质询

用户在真实应用（暗色主题）打开 demo-bug.kanban 截图质询：统计卡大数字（6/11/5/17）与副说明几乎同尺寸（约 14px），「这种字体这么小是技能的问题吗？」

### 诊断（全部 CDP 实证，零推测）

1. 应用以 `electron --remote-debugging-port=9333` dev 直启，加载 vite dev server（localhost:5273）→ 渲染进程代码实时热更新，「应用跑旧代码」的假设排除。
2. CDP 连主页面读看板 iframe 的 srcdoc 属性 → token 块只有 32 字符 `:root{--mx-text:rgb(15, 17, 21)}`（保底分支）→ `for (const name of cs)` 枚举在 Electron 33（Chromium 130）下一个自定义属性都拿不到，实锤。
3. 结论：**不是技能的问题**——技能产物 CSS 正确（28px 写了），是宿主注入代码的枚举方案在该 Chromium 版本不工作；`var(--mx-font-family)` 空 → `font:600 28px/36px var(...)` 整条声明 invalid → 回退继承 14px。

### 修复与验证

- DetailPanel.vue：枚举改为 `TOKEN_NAMES` 显式清单（约 50 个看板卡所需语义 token 逐名 `getPropertyValue`）；build_harness.py 同步。
- CDP 复查：token 块 32 → 2144 字符；连进 w-stat iframe 实测 `fontSize:28px / fontWeight:600 / lineHeight:36px`，副说明色 `--mx-text-secondary` 生效。vite 热更新自动生效，无需重启应用。

### 教训（运行时实证）

- 「Chromium computed style 枚举含自定义属性」是未实证的假设——本机 Chrome 枚举可用，Electron 33 不可用，环境差异让 harness 验证 PASS 掩盖了真实失效。跨运行时能力必须直接在目标运行时里实证（应用的 CDP 端口是现成通道，srcdoc 属性父页面可读，iframe 有独立 target 可连入实测 computed style）。
- `font` 简写里放 `var()`：var 空值导致整条声明作废回退继承——单 token 失效会放大成整条排版失效。
- 排查「改动未生效」先分层：dev server 直启（改动即时生效）vs 构建产物（需重新构建）；`electron/dist/main.js` 的 mtime 只关系主进程，与本轮渲染进程改动无关。

## 清单标题改显 <board name>（2026-09-30 追加）

用户截图质询：侧栏看板列表显示的是文件名（bugs / demo-bug）而非看板名。改动（store.ts + SidebarSection.vue）：refreshList 对每个 .kanban 读内容轻解析 `<board name>`（peekBoardTitle，宽容解析缺失回退文件名），FsEntry.mod_time 未变直接用缓存（tool_exec_end/loop_end 高频触发避免全量重读）；行显示 title、tooltip 恒显文件名。CDP 实证侧栏五条全部显示中文标题（缺陷看板 / 架构看板 · 交易平台 / 缺陷看板 · 发布前冲刺 / 人力看板 · 研发二组 / 项目跟踪 · M2026-41）。

## 技能族合并定稿（2026-09-30 第七次修正，用户拍板）

### 转向原因（用户原话要点）

用户提议：「将全部看板技能合成一份，将几种应用方案全部作为引用，都放在 kanban 技能内，作为一种让 Agent 直接选择的项，这样对于 Agent 的执行效率貌似会更加高，而且技能也相当集中。」

### 合并理由（达成共识）

1. 原 4+1 结构每次执行都双跳（场景技能第 0 步强制先读 kanban-spec 再回来）——两次技能加载加一次往返，纯开销。
2. 跨技能交叉引用是维护隐患（协议/规范每改一次要同步 4 个场景技能；幽灵引用教训）。
3. 单技能 description 全量枚举四场景触发词，模糊请求一次命中，比 5 技能分散命中可靠。

### 定稿结构

```
.agents/skills/kanban/
  SKILL.md              # 主体：何时用/工作流程/协议/设计规范/基底环境/红线/场景路由/资源
  scripts/new_board.py
  references/
    scene-{project,hr,bug,arch}.md   # 场景指引（给谁看/布局语言/部件引导/语义色映射/取数来源/范例）
    card-cookbook.md
    example-{project,hr,bug,arch}.kanban
```

要点：场景从系统级技能降为技能内 references 路由（「场景驱动」内核不变）；工作流程第 1 步与红线写死「未读对应 scene-*.md 不得开工」；scene 文件去 frontmatter/第 0 步/工作流程（取数来源保留并入），通用纪律一句引用 SKILL.md 不重复。旧 5 目录已删除，全仓库活跃引用清零（notes 历史记录保留不改）。

### 教训（技能合并）

「分层」只有在各层有独立生命周期时才值回成本——规范与场景同频演进时，双跳结构只付利息。表格用 MD060 aligned 风格时，改动单元格文字必须整表重排（Python 按显示宽度重排：east_asian_width F/W 记 2，与 IDE lint 语义一致）。

## 命名定稿：仪表板（2026-09-30 追加）

- **「看板」→「仪表板」改名定稿（用户拍板）**：该插件实质是 Dashboard（数据面板/监控墙/HR/架构），而「看板」在中文软件语境已被 Kanban 任务流强占——且本项目内部 chatflow/tree 的「任务看板」（TaskList 快照）才是真 Kanban，同一产品两个「看板」语义在打架。Agent 侧歧义传导链 = SKILL.md 触发词 + 文件扩展名 + 落盘目录路径，全部已统一：`.dash` / `.agents/dashboards/` / 技能目录 `.agents/skills/dashboard`。
- **改动范围（用户选「含扩展名与目录」档）**：UI 文案 + 技能全套（SKILL.md/scene-*/card-cookbook/new_board.py/example-*.dash）+ store 扫描与路由（KANBAN_EXTS 'dash'、kanbansDir）；**代码标识符保留 kanban 词根**（useKanbanStore/KANBAN_DETAIL_ID/kanban.store 服务名），语义收益为零的 churn 不做。usage 插件「Token 用量看板」注释同步改「仪表板」。
- **批量改名技巧**：git mv 对未跟踪目录报「source directory is empty」——先 git check-ignore 判定，未跟踪直接 mv；文本批量用 python str.replace 按序（`.kanban`→`.dash` → `kanbans`→`dashboards` → 看板→仪表板 → 仪表盘→仪表板 → 独立 kanban→dashboard），最后一档会把 frontmatter name 一并纠正；注意合并触发词产生的重复（「看板 / 仪表盘」变「仪表板 / 仪表板」需手修）。
- **改名后端到端实证**：pinia 设 currentProjectDir → 侧栏「仪表板」节出现（title 解析正常）→ 点击行 Detail「仪表板」tab 打开渲染 → 产物面板技能段自动显示新名 dashboard（发现式扫描按目录名）。
