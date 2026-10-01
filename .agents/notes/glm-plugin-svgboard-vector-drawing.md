# svgboard SVG 矢量画板插件落地

日期：2026-09-30
涉及：plugins/src/svgboard/（新：store / DetailPanel 画布 / index / ToolbarTrailing）、chatflow/store.ts、explorer/TreeNode.vue、plugins/package.json、plugins/src/index.ts、app/src/main.ts

## 事实

- **二轮补齐（用户否决"无文本/对齐/编组即不可用"后）**：文本工具（点击放置 + panel 相对定位浮层编辑 + 双击再编辑，text 内容存 shape.text 字段序列化为 `<text>content</text>`）、多选（Shift 点选 + 空白拖动框选 marquee，视觉 bbox 相交选中）、对齐六向（单选对画布 / 多选互对齐）、编组/解组（单层展平语义——group 不嵌套，编组时把选中 group 展平进新 group；解组把 group translate 落回各 child）。
- **对齐/框选 bbox 取视觉矩形**：不解析基元几何，统一 `el.getBoundingClientRect()` 反换算回 svg 坐标（canvasScale 居中补偿 + viewBox 偏移），天然含 transform、对 group/text 同样成立。
- **多选拖动必须帧增量**：每帧 merge(client - lastDrag) 后更新 lastDrag；用"起点总位移"累积 merge 会导致 translate 指数膨胀（首版单选拖动就有此 bug，多选重构时修正）。
- **SVG 导入改递归 importNode**：g → 单层 group（transform 仅保留纯 translate，正则 `/^translate\(...\)$/` 全匹配；其余变换丢弃），text 取 textContent（trim 空兜底空格）；基元统一 circle→ellipse、polyline→path d（三轮起 polygon 保留原生基元不再转 path）。
- **SVG 画板零依赖可行**：SVG 本身就是 DOM——DOMParser 导入、setAttribute/v-bind 渲染、字符串拼接序列化导出，无第三方库（对比：canvas 库 fabric.js 不是 SVG；excalidraw 是 React 生态不匹配 Vue）。
- **daemon 文件读写闭环实证**：读 `fs.read_base64`（文本文件 atob 解码）；写 `fs.write`（`{ path, content }`，已存在文件覆盖写——explorer/store.ts makeFile 注释实证）。SVG 是文本格式，二者即完成画板文件 IO。
- **图形模型 = `{ id, kind, attrs, text?, children? }`**：attrs 直接 v-bind 到 SVG 元素并原样序列化落盘（无独立样式层）；circle→ellipse（r→rx/ry）、polyline→path（points→d）导入时统一基元；g 变换与不认识节点首版丢弃（明示边界）。
- **三轮多边形工具（polygon 原生基元）**：交互 = 依次点击落顶点 + 橡皮筋预览（polyHover 随 pointermove 更新、pointerleave 清空），闭合走双击 / 回车 / 点回起点（阈值 10/scale）三条路；commit 前连续过近点（<2px）去重——双击闭合前两次 pointerdown 会落近重点，去重吸收。切换工具时 watch(tool) 自动收口（<3 点静默丢弃）；Esc 丢弃、Enter 闭合在 onKeydown 里优先于 ⌘ 组合分支。序列化零改动（serializeShape 默认分支 `<polygon ${attrs}/>` 天然覆盖）；拖动/对齐/框选/编组全走 mergeTranslate + visualBBox 通用路径，新 kind 无需单独适配。
- **lucide 没有 polygon 图标键**：多边形工具用 `lucide:hexagon`（实测 icons.json 存在；polygon 键不存在）。
- **交互要点**：pointerdown 起用 `setPointerCapture`（拖出画布不丢 move/up）；viewBox meet 模式坐标换算要居中补偿（scale=min(bw/vw,bh/vh) + ox/oy 补偿）；零尺寸误触丢弃时同步 `history.pop()` 回滚快照栈。
- **接线与查看器范式一致**：Detail order 106（image 103 / doc+web 104 / video 105 / svgboard 106）；`svg` 扩展名从 IMAGE_EXTS（chatflow + TreeNode 两处）移到 SVGBOARD_EXTS 路由 svgboard（查看编辑一体）；Toolbar trailing `ToolbarIconButton` 入口对齐 web-viewer 先例（组件 setup 期直接 useXxxStore()）。

## 技巧与坑

- **`<input type="color">` 不认 'none'**：填充的"有/无"开关与取色器必须分离——取色器绑定独立 fillPick ref，toggleFill 在 fill='none' 与 fillPick 间切换；直接 v-model fill 到 color input 会在 'none' 时回退黑色。
- **attrs 记录展开混入非 string 值**：`{ id: nextId++, ...shapeAttrs() }` 把 number id 混进 `Record<string, string>` 报 TS2322；id 必须放 shape 顶层而非 attrs。
- **模板手滑无效属性连续两次**（`:class-fill-dot`、`:class-selected`）：Vue 模板里手写伪绑定不报编译错、运行时静默成 attrs，写模板 class 绑定时要用数组对象语法 `:class="[$style.a, { [$style.b]: cond }]"` 一气呵成，不拆行手打。
- **范围输入（viewBox 比例换算）与 client 增量换算共用 canvasScale()**，避免两处比例公式漂移。

## 四轮：白底 + 预设形状库（2026-09-30 追加）

- **画布固定白底是用户明确要求**：`.body`/`.canvas` 写死 `#ffffff`（不随主题），删棋盘格透明模拟；1px `var(--mx-border)` 边框保边界清晰。serialize 首元素注入 `<rect id="svgboard-bg" fill="#ffffff">`（落盘文件任意查看器同为白底），importNode 按 `attrs.id === 'svgboard-bg'` 跳过——白底不属于图形内容，不进撤销栈/图形列表。
- **预设形状库 = presets.ts 独立文件**：84 个预设分 9 类（基础 31/直线 5/泳道 3/流程图 15/类图 7/时序图 9/数据流图 6/ER 4/组件图 4），每项 `{ id, label, category, w, h, view, build(style) }`。几何以 (0,0) 原点生成，放置时顶层加 `transform: translate(视口中心)`，兼容 mergeTranslate/visualBBox/translateOnly 全部既有通用路径；多元素预设自动组单层 group（children 复用 nextId）。
- **TS 混合 kind 数组字面量归并陷阱**：`build: () => [{...rect}, {...ellipse}]` 会被 TS 归并成带 `cx?: undefined` 键的对象类型，赋给 `attrs: Record<string, string>` 报 TS2322——数组形式的 build 必须显式标注返回类型 `build: (): PresetElement[] => [`（replace_all 一次覆盖）。
- **v-html 预览线稿必须统一合并兜底样式**：build 只产几何、样式由放置时注入——previewMarkup 若只透传 build 结果，预览元素没有 `fill="none" stroke="currentColor"`，SVG 默认 fill 黑色整面板实心黑块。预览侧 `attrs: { ...PREVIEW_STYLE, ...el.attrs }` 兜底（元素自有覆盖优先，如实心箭头 fill=currentColor、虚线 dasharray）。v-html 用在 `<svg>` 上安全（内容纯内置常量）。
- **HMR 状态错位会伪装成代码 bug**：DetailPanel 热更新后点开画板报 `Cannot set properties of null (setting '__vnode')`（patchKeyedChildren 中 n1.el 为 null），堆栈指向 Vue patch 而非业务代码——先 `page.reload()` 干净加载再判定，reload 后消失即为 HMR 遗留，勿回头乱改代码。
- **连续点击放置会全部叠在视口中心**：placeShift 递进（`step = (placeShift++ % 6) * 28`）横向错开。
- **CDP 验证路径**：connectOverCDP(9333) → `[title="新建画板"]`（详情轨道工具栏）→ 画布 computed background 断言 `rgb(255,255,255)` → `[title*="形状库"]` 开面板 → 按 title 点预设 → 数 `[data-shape-id]`。

## 五轮：选中属性工具栏（2026-09-30 追加）

- **上下文工具栏 = 单选悬挂浮层**：`selectedIds.length === 1` 时在选区视觉 bbox 上方浮出（`ctxBar` panel 相对定位 + `translate(-50%, -100%-10px)` 水平中心对齐），内容随 kind：更改图形（非 text/group）、填充色+有无切换、描边色、线宽三档、字号（text）。多选/编辑文本/无选中即隐藏。
- **watch 必须 flush 'post'**：定位用 visualBBox 查 DOM——默认 flush 'pre' 在组件更新前跑，刚放置/选中的图形 DOM 还没渲染，`querySelector('[data-shape-id]')` 落空 → ctxBar 永远不出现（首版 bug）。定位类 watch（selectedIds / shapes deep / editBox）全部 `{ flush: 'post' }`。
- **shapes deep watch 让工具栏拖动跟随**：mergeTranslate 帧增量改 attrs 触发 deep watch → 每帧重算 bbox，flush post 合并同 tick 多次改动，无性能问题。
- **更改图形（changeShape）**：单元素 kind 才提供（group/text 排除；预设侧用 `build()` 试跑排除 group 形态 → 63 个单元素预设）。替换 = 保留原 stroke/stroke-width/fill 样式 + 以原视觉中心放置预设默认尺寸（`translate(中心-尺寸/2)`），不做 bbox 缩放（首版边界，path 无法参数化尺寸）。
- **撤销粒度**：色值 @input 连续触发用 liveAttrs（首次快照、colorSnapDone 标志、@change 复位）避免刷爆撤销栈；离散操作（线宽/填充切换/字号/更改图形）走 patchAttrs 每次快照。
- **CDP 验证的 title 同名坑**：形状库「矩形」与工具栏绘制工具「矩形」title 相同、ctxShapes「椭圆」与绘制工具「椭圆」相同——click 必须限定容器 `[class*="shapesPanel"] [title=…]` / `[class*="ctxShapes"] [title=…]`，否则点中工具栏切换工具、脚本还以为放置/更改成功（本案连续踩两次）。

## 六轮：预设图标双主题可见性（2026-09-30 追加）

- **半透明浮层叠白画布 = 暗色对比度杀手**：`--mx-menu-bg` 亮/暗都是半透明（0.58/0.5），形状库面板浮在固定白底画布上，暗色底被稀释成中灰，浅灰图标（text-secondary）叠上去几乎不可见——用户描述「全都透明了」。根因不是 token 作用域（`:root[data-mx-theme='dark']` 全局级联没问题），是半透明底+无 backdrop-filter。
- **UIKit 浮层先例要照抄而不是自创**：controls.css 的 `.mx-menu` = menu-bg + `backdrop-filter: var(--mx-backdrop-menu)`，且 macOS Electron 透明窗口下 backdrop-filter 失效（Chromium 对透明根合成 blur 为空），darwin 下统一用 `--mx-menu-bg-opaque`（0.94）补偿。画板三个浮层（shapesPanel/ctxBar/ctxShapes）修后直接用 menu-bg-opaque——画板浮层叠的是白画布而非桌面，blur 没意义，opaque 是唯一正确解。
- **图标前景色用 text-secondary 会像禁用态**：形状预设按钮 color 从 `--mx-text-secondary`（亮色中灰 rgb(97,102,107)）改成 `--mx-text`（亮色近黑/暗色近白），双主题都清晰且不再像不可用；hover 已是 mx-text 无需改。
- **硬编码 box-shadow 违反 token 纪律**：浮层阴影 `0 8px 24px rgba(0,0,0,0.14)` 换成 `var(--mx-shadow-prominent)`（对齐 .mx-menu）。
- **CDP 验证 SVG 内部元素要点**：`page.click('[data-shape-id]')` 会被父级 `<svg>` 拦截（intercepts pointer events）超时——选图形用鼠标坐标点击或直接依赖已有 `_selected` 状态；另外 `data-mx-theme` 可直接 `document.documentElement.setAttribute` 切主题实证 CSS 级联（token 选择器是唯一事实源），连接时先记录原主题、测完还原。reload 会丢未保存画布内容，重画一个矩形是最可靠的 ctxBar 唤出路径。

## 七轮：产物面板项目级技能 + 待办段（2026-09-30 追加，chatflow/ProductsPanel + TodoPanel）

- **产物面板技能段从全局库改为项目级 `.agents/skills`**：`skill.list` 带 `{project_dir}`（daemon DiscoverProject 发现式扫描），条目精简投影只有 name/description/root_dir（**无 metadata，没有 name_zh 中文展示名**）；watch currentProjectDir 重拉（目录可能晚于挂载就绪，immediate 兜底）。
- **「安装至技能库」= skill.promote** `{name, from:'project', to:'global', project_dir}`（晋升为纯复制搬运，同名默认拒绝，覆盖需 overwrite=true）；**「删除」不能用 skill.delete**——它只删全局库（Global().GetSkill→os.RemoveAll），项目内删除走 `fs.rm {path: root_dir, recurse: true}`。行为语义先查 handler 实现再定，不能望文生义。
- **TODO.md 待办段保真策略**：rawLines 存原始行 + TODO_RE `/^(\s*[-*] \[)([ xX])(\] .*)$/` 捕获组定位任务行；增=push/删=splice/改=按捕获组重拼该行，写回全量 join——非任务行（用户手写内容）原样保留。**捕获组 m[3] 含 `]`**，重拼文本时写 `${m[1]}${m[2]}] ${text}`，漏 `]` 会让该行不再被 RE 匹配而从 UI 消失（首版真 bug，实测抓到）。
- **空文件 split 边界**：`''.split('\n')` = `['']` 产出一个空行，读回时 body 为空直接归 `[]`。
- **CDP 驱动 mindx-work 界面的实操路径**：reload 后会话/详情轨道全关；入口链 = 侧栏会话行（叶子文本匹配，注意消息摘要截断如「帮我安装 Agent Reac…」）→ `[title="打开会话产物"]`；无工作目录的会话技能/待办段显示空态。**绕过会话切换的轻量法**：`document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s` 拿 store（chatflow-store），直接赋 `store.currentProjectDir` 触发 watch 重拉——UI 交互仍走真实链路。
- **Playwright 双击编辑的坑**：dblclick 触发 Vue 编辑态后 span 被 input 替换，locator 失效导致 Playwright 动作重试超时——用 `dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))` 触发后直接操作 input。
- **`| tail` 吞退出码假象**：`vue-tsc | tail` 的 exit code 是 tail 的（永远 0），上一轮 typecheck「通过」是假的；判断要用输出内容或 PIPESTATUS。既有错误一例：plugins 无 vite 依赖（vite 7 装在 app/），`import.meta.glob` 类型缺失——Vite 7 client.d.ts 不再内联 glob 声明，手写最小 ImportMeta interface 增强解决（vite-env.d.ts）。MxIcon :size 类型只收 16|20。
