# kanban 插件实施记录（Agent-Driven UI 动态看板）

> 2026-09-30 实施完成。设计定稿见 glm-plugin-kanban-agent-driven-ui.md（含 2026-09-30 用户修正：不做 Widget 市场，Widget 能力供给 = Skill，提供一堆 Skill 教 Agent「现做」看板）。

## 交付清单

- `plugins/src/kanban/`：store.ts（文件 IO + 事件刷新）、DetailPanel.vue（24 栏栅格 + 白名单注册表）、widgets/ 八类（stat/list/table/progress/board/gantt/markdown/iframe）、AddToChat.vue、SidebarSection.vue、index.ts、tone.ts。
- 路由接线四处：chatflow/store.ts openFile（KANBAN_EXTS）、explorer/TreeNode.vue、plugins/package.json exports、app/src/main.ts 装配（svgboard 后）。
- 技能：`.agents/skills/kanban-ui/SKILL.md`（教 Agent 布局/数据协议与生成流程）。
- 示例看板：工作区 `.agents/kanbans/bugs.kanban` + data/*.json（5 个数据文件演示标量/对象/数组/多类型）。
- 验证：typecheck + lint + build 全绿。

## 实证坑（下次直接复用结论）

1. **file_modified 不能做 Agent 写盘刷新通道**：goharness 该事件在工具执行**前**发出且仅文件首次进 ModifyFiles 时发一次（core/goharness/events/types.go L94-99），内容写完不触发。刷新通道 = `daemon.onNotification('tool_exec_end'/'loop_end')` + 400ms trailing 合并（envelope 不带文件路径，不做路径过滤；reload/refreshList 幂等只读，空转开销为零）。
2. **base64 读中文 JSON 必须经 TextDecoder**：`atob` 直转是 Latin-1，中文必乱码。`decodeBase64Utf8`（atob → Uint8Array → TextDecoder('utf-8')）是标准解法，svgboard 的 atob 直转对 ASCII SVG 无感但不可复制到文本类文件。
3. **Sidebar.add 的 rows 必须给空数组**（整节由组件渲染时也不能省，缺了壳抛错）；壳无 `Sidebar.remove` API，插件清理函数不清 Sidebar 节（chatflow 先例同）。
4. **EP el-row/el-col 无行距**：gutter 只管列间距，行间距需在 el-col 上自加 margin-bottom。
5. **CSS Modules 命不中 v-html 子元素**（无 hash 属性）：markdown 卡样式用 `.md :global(p)` 形式书写。
6. **EP el-progress 的 color 可传 CSS 变量字符串**（`var(--mx-state-success)`），tone → 状态色映射由此走 token，无字面色值。
7. **看板数据协议容错分层**：形状不符整卡落「数据格式不符」（BAD_DATA），协议合法但空落「暂无数据」（NO_DATA），dataRef 装载失败错误文案进卡内——三种态分开展示，单卡异常不炸整板。

## 结构决策

- 渲染白名单唯一权威 = DetailPanel 的 REGISTRY 映射（type → 组件）；store 不重复维护 type 常量（避免死代码，曾写 WIDGET_TYPES 后删除）。
- widget 子组件统一 props 契约：`{ data, error, props }`（widgets/common.ts WidgetBasis），DetailPanel 装配时解 dataByPath 传入。
- 工作区路径复用 chatflow.store（currentProjectDir + isConnected 双 watch，重连/切目录自动重拉清单）；chatflow 停用时 try-catch 降级空清单。
- gantt 零依赖 SVG 自绘（viewBox 720 逻辑宽），tone 条色 = 背条 fill-opacity 0.3 + 前景按进度截宽，today 线 accent 虚线。
- dataRef 文件级引用（一个文件一个 widget），需要细分让 Agent 拆数据文件——协议简单性优先。
