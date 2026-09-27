# ChatFlow 移植计划（mindx-desktop chat → mindx-work 插件）

> 状态：决策点已定稿（§5），待最终批准后按期实施，每期完成后跑该期验收口径。
> 上游：[chatflow-概念框架.md](./chatflow-概念框架.md)（设计权威）；本计划只管「怎么搬」。
> 时序（2026-09-26 修订）：**Daemon 大修仍后置**；但 Tasks 数据源的**最小配合项**（全量会话列表 / 跨 Agent 最近活跃 / Session.title 三件 RPC）随四期点状实施——用户定案「必须动 Daemon，动了收益比回头收改要大」。其余 Daemon 前置依赖（.sessions 迁移、项目化技能落位）保持挂起。

---

## 1. 源侧清点结论（实证）

### 1.1 两代体系的关系（不是并列，是分工）

产线接线（import 链实证）：

```text
ChatArea.vue ─→ ChatRound/index.vue（轮容器）─→ tree/shell（TreeView / TreeNodeItem / NodeCard / useNodeActions）
                                              ├→ tree/round（RoundHeader / RoundFooter）
                                              └→ tree/registry + tree/builder（buildTreesForRounds）
```

- **tree 体系是现役渲染架构**：32 种节点判别联合（3 执行内容 + 4 实体协作 + 7 阻塞系统 + 18 工具）+ 四表穷举 registry（components / summary / actions / icons）+ 纯函数 builder（按轮记忆化 + 实体 upsert + 子会话流内联）。
- **ChatRound/ 目录下的旧视图并未全死**，一半是被树节点复用的「叶子渲染器」：

| ChatRound/ 文件 | 现状（import 实证） | 处置 |
| --- | --- | --- |
| index.vue | 现役轮容器 | 移植（组织原则载体） |
| UserMessageRow.vue | ← RoundHeader 引用 | 移植 |
| FormattedContent.vue | ← ContentView / SkillNodeView / WebSearchNodeView | 移植 |
| ErrorView / CompactionView / MaxTurnsWarning / LLMRetryWarning | ← 对应树节点视图 | 移植 |
| ProcessView/TaskListView.vue | ← TaskQueryNodeView | 移植 |
| ProcessView/BashTerminalView.vue | ← RunScriptNodeView | 移植 |
| **ProcessView/index.vue、ThinkingView.vue、ActionsView.vue** | **零引用，死代码** | **不移植** |
| **ResultView.vue（755 行）** | **零引用**——答案形态已由 content 节点 standalone（NodeCard + ContentView + actions.ts 操作组）+ RoundFooter 承载（ChatRound/index.vue 注释「操作组平移自现役 ResultView」） | **不移植** |
| **SubAgentView/index.vue（612 行）** | **零引用**——SubagentNodeView 全卡直渲替代 | **不移植** |

死代码合计约 2400 行，不搬。

### 1.2 源侧依赖面（chat/ 目录之外的全部引用）

| 依赖 | 形状 | 移植策略 |
| --- | --- | --- |
| `stores/chatStore`（2356 行） | ChatMessage / ChatRound 类型 + 会话消息流状态 + 事件归一 | 类型投影进 `model/`；状态逻辑重写为 ChatFlow store（四期） |
| `stores/sessionStore`（562 行） | Session（含 title / project_dir / session_dir）+ Tab 模型 | Session 类型投影；Tab 模型不搬（壳 Content 单活动视图替代） |
| `stores/connectionStore`（1640 行） | WS 连接态 + 事件分发 | 不搬——目标仓 connection 插件 `daemon.connection` 服务已具备同机制（DaemonSocket：call + onNotification + 状态回流） |
| `stores/scheduleStore` | useNodeActions 一处引用 | 实施期核对该引用实际消费面，随四期接线 |
| `stores/subtaskPersistence` | localStorage 子任务登记（builder restore 三路合成旁路） | 机制原样保留（localStorage 可用），随 builder 平移 |
| `services/websocket`（getMindXClient） | 发消息 / 重试等 RPC | 换 `useService('daemon.connection')`（实证：connection/index.ts provide、skills 插件消费先例） |
| `services/imageUpload` | 图片 → 会话临时目录落盘 | RPC 通道换 daemon.connection，机制随 ChatInput 移植 |
| `composables/useMarkdown` | markdown 渲染（5 处叶子视图引用） | 随 ChatFlow 平移为插件内部模块；实施期与 skills/markdown.ts 核对去重 |
| `utils/agentMeta`（isAgentHired） | AgentSwitcher 一处 | 实施期核对面，随 Tasks 期接线 |
| `@element-plus/icons-vue`（ArrowRight / VideoPause 等）+ toolIcons 的 mdi 映射 | 图标 | **全部换 MxIcon + Iconify**（界面军规 9）；一期产出映射表 |

### 1.3 体量

源 chat 体系约 11980 行 + 外围（ChatArea 1173 / SkeletonChat 139 / SessionDrawer 382 参考）。扣除死代码约 2400 行、扣除重写件（store 层），**净移植约 8500 行，重写约 2500 行**。

---

## 2. 目标形态（席位与目录）

### 2.1 席位（框架 §6.1 / §7 / §8 定稿）

| 席位 | 注册物 | 期次 |
| --- | --- | --- |
| Content | ChatFlowPage（对话流 + ChatInput；空会话 hero 形态） | 一期骨架 / 三期输入 / 四期数据 |
| Sidebar 节 | **Tasks**（任务导向会话列表；行 = 任务名 + 运行状态 + 最后活动时间 + 未读标记，无内容预览）+ 「新会话」按钮卡（variant button） | 一期静态 / 四期真数据（全量分组 + 最近讨论，数据源为四期 Daemon 配合项） |
| Detail | 「产物」单 tab——**挂起**（前置 .sessions 迁移），本期不注册 | — |
| 槽位 | ChatFlowSlotHost + register（§8；v1 不含 market 动态开放） | 五期 |

阻塞交互（permission / ask_user）：Content 页内**吸底交互区**（desktop 的底部 Drawer 语义；work 契约 Overlay 只收全局层，局部浮层归插件自渲染——PermissionBar / AskUserView 恰是局部语义）。

### 2.2 插件目录规划

```text
plugins/src/chatflow/
├── index.ts              # 插件入口：Content + Sidebar 节注册 + 清理函数
├── ids.ts                # 条目 id / service 名常量
├── store.ts              # ChatFlow store（一期空壳 → 四期充实）
├── model/
│   ├── message.ts        # ChatMessage 类型投影（源 chatStore，字段逐一核对）
│   ├── session.ts        # Session 类型投影（源 sessionStore）
│   └── subtask.ts        # PersistedSubtask + localStorage 登记（源 subtaskPersistence）
├── tree/                 # tree 体系整体平移，内部结构不动：
│   ├── types/            #   32 节点判别联合（纯类型，原样）
│   ├── builder/          #   index / groupBuffer / tool-map / restore（原样，import 改 model/）
│   ├── registry/         #   components / summary / actions / icons（icons 适配 MxIcon）
│   ├── shell/            #   TreeView / TreeNodeItem / NodeCard / PendingRow / useActivePath / useNodeActions
│   ├── round/            #   RoundHeader / RoundFooter
│   ├── nodes/            #   24 节点视图 + shared 4 件 + index.ts
│   └── styles/           #   shimmer.css（token 核对后并入）
├── chatround/            # 轮容器 + 存活叶子：index.vue / UserMessageRow / FormattedContent /
│                         #   ErrorView / CompactionView / MaxTurnsWarning / LLMRetryWarning /
│                         #   TaskListView / BashTerminalView
├── content/
│   ├── ChatFlowPage.vue  # Content 页（源 ChatArea.vue 改造：滚动/骨架屏/吸底区/hero）
│   ├── ChatInput/        # index.vue + NoModel.vue + fileRefNode.ts（全量移植）
│   ├── BottomBar/        # PermissionBar / AskUserView（吸底交互区）
│   └── SkeletonChat.vue
├── sidebar/
│   └── TasksSection.vue  # Tasks 列表（分组 + 新会话按钮卡；源 SessionDrawer 仅作参考不搬形状）
├── slot/                 # ChatFlowSlotHost + register（五期）
├── markdown.ts           # useMarkdown 平移
├── toolViewUtils.ts      # formatDuration 等共享函数
└── toolIcons.ts          # 工具→Iconify 映射（mdi 全量改 lucide）
```

三处装配注册走脚手架（exports 子路径 / plugins/src/index.ts re-export / app/main.ts 装配清单）。

---

## 3. 分期切法与验收口径

每期通用验收：`pnpm typecheck` + `pnpm lint` 零错误；**超 500 行必跑 mx-audit 并清零**；Playwright（dev 5273）断言渲染 / 交互 / 0 页面错误 + 截图（判据军规按 mx-plugin-dev SKILL）。

### 一期：插件骨架 + 数据契约层（约 2900 行）

- 脚手架生成 chatflow 插件 + 三处装配注册；Content 页与 Sidebar「新会话」按钮卡静态挂载。
- `tree/types/` 全套 + `tree/builder/` 全套 + `registry/summary.ts` + `registry/actions.ts` 原样平移；`model/` 三件类型投影。
- **token 映射表**（desktop `--space-*/--font-*/--text-*/--bg-*/--accent-cyan/--radius-*` → `--mx-*`）与**图标映射表**（toolIcons mdi → lucide）在本期产出，后续期照表施工。
- 验收附加：builder 纯函数行为断言——`scripts/` 下以 fixture 消息流（一轮含 thinking / 工具 / group 聚合 / subtask / permission / error）跑 `buildTreesForRounds`，断言节点树形状（node --test，对齐 work 测试形态）。

### 二期 A：树壳 + 名片 + 简单节点（约 2600 行）

- `tree/shell/` 全套（TreeView 折叠覆盖 Map / 活跃路径 / gap 标记 / pending 行）+ `round/` + `chatround/index.vue` 轮容器 + NodeCard 统一名片。
- `registry/icons.ts` + `registry/components.ts`（适配 MxIcon）；`nodes/shared/` 4 件；content / thinking / bash / ls / glob / grep / write / edit / error / cancelled / compaction / max-turns / llm-retry / notify / sleep(null) 等简单节点视图。
- 验收附加：fixture 数据静态驱动渲染（store 空壳供 fixture），Playwright 断言：树导轨线、group 组头折叠、名片四要素、gap 标记、轮收拢 Agent 行。

### 二期 B：复杂节点 + 存活叶子（约 3300 行）

- subagent（269 行全卡 + children 内联直播路径）/ task / team / team-ops / collect / ask_user / permission / cron / skill / task-query / run-script / web-search / web-fetch / kb-search / memory-search 节点视图。
- 存活叶子八件（UserMessageRow / FormattedContent / ErrorView / CompactionView / MaxTurnsWarning / LLMRetryWarning / TaskListView / BashTerminalView）+ toolViewUtils + markdown.ts。
- RoundFooter（文件变更摘要 / 用量统计 / Context ring）。
- 验收附加：fixture 覆盖 subagent 子会话流嵌套、task 看板快照、permission 审计闭环三场景截图。

### 三期：ChatInput（约 1300 行）

- 输入区全量移植（fileRefNode 文件引用、NoModel 未配模型占位、图片上传机制）。
- 空会话 **hero 形态**：居中 + Logo 标题「探索人机共生的新时代」+ beta 上标。
- 第一波增强四项（@ 引用 / 附件上传 / 模型快速切换 / 任务上下文自动携带）。其中模型快速切换跨插件消费 models 服务、@ 引用依赖文件列表 RPC——凡 daemon 无对应 RPC 的部分，**本期只做 UI 与数据通道预留，功能点标注挂起**，禁止猜测 RPC。
- 验收附加：输入 → 假发送（store action 打桩）→ 清空回 hero；disabled / NoModel 态截图。

### 四期：数据层 + Tasks + 阻塞交互（约 3000 行，重写为主）

- **Daemon 最小配合项**（点状变更，先行）：①按 Agent 全量会话列表查询；②Daemon 级最近活跃会话查询（跨 Agent）；③Session.title 属性（新建会话由大模型从用户问题提炼，用户可编辑）。范围严格限定三件，大修不动。
- ChatFlow store：会话列表（经 `daemon.connection`，RPC 方法名以 desktop websocket 消费面逐一对准，**不猜协议**）、消息流加载、实时事件订阅（onNotification：content_delta / tool_exec / subtask / permission_request 等全族）、发送 / 重试 / 回退轮、错误分类（desktop chatStore.classifyHttpError 语义平移）、builder 会话状态清理（clearTreeBuildState 调用点保留）。
- Tasks 真数据：**全量分组制**（按目录名）+「最近讨论」捷径区（跨 Agent，先切 Agent 再切会话）；行信息 = 任务名（title）+ 运行状态 + 最后活动时间 + 未读标记。
- 新会话 Agent 归属：ChatFlow 内建轻量切换器（源 AgentSwitcher 形态移植，消费 agents 插件经 services 提供的数据）。
- 底部交互区：PermissionBar / AskUserView 接 store（pending 状态 ↔ RPC 回复）；SkeletonChat 接换会话加载。
- ChatFlowPage 完整装配（ChatArea.vue 改造收尾：渐进式加载 3 轮/页 + 超 10 轮移除 DOM + 游标折叠占位——游标数据依赖 Daemon 大修，本期渲染机制就位、数据源挂起）。
- 验收附加：**本地 daemon 真机全链路**——新建会话 → 发消息 → 流式 → 工具节点 → 授权/提问阻塞交互 → 轮收拢 → 换会话 → 历史恢复。

### 五期：槽位机制（约 400 行）

- ChatFlowSlotHost / ChatFlowSlotSpec 类型 + register API + presentation 必填校验 + 保留键不可认领 + 冲突抛错；渲染出口唯一（树壳 `<component :is>` 分派挂贡献层优先、内建兜底）。
- v1 边界（§8 定稿）：不做 market 动态开放、不做内建键覆盖、不做输入区/轮级/Drawer 槽位。
- 验收附加：fixture 扩展注册一个槽位视图，断言渲染出口与保留键拒绝。

---

## 4. 横切适配专项

| 专项 | 规则 |
| --- | --- |
| 主题 token | 军规 3/4：全量禁字面色值；desktop token 按一期映射表换 `--mx-*`，缺位 token 就近映射并在映射表留痕 |
| 图标 | 军规 9：el-icon 引用的 @element-plus/icons-vue 组件、toolIcons 的 mdi、icons.ts 全部改 `MxIcon name="lucide:*"`，16/20 两档 |
| 注释与命名 | 代码注释一律中文；desktop 源注释随行平移保留 |
| 服务通道 | 数据走 `daemon.connection`（形态 A 命令 + 形态 B 订阅）；ChatFlow 对外提供的服务（若有）四期定名并登记 ids.ts |
| 共享件纪律 | markdown / DiffBody 等留在 ChatFlow 内部；跨插件复用需求出现时再按「共享型组件上提」办理，不预设 |
| Element Plus | 壳已全局装配（zIndex 3000 起）；el-collapse-transition / el-icon 等沿用，工具提示一律 ElTooltip |

---

## 5. 决策点（2026-09-26 已定稿）

1. **Tasks v1 数据范围** → **随四期动 Daemon 最小配合项**（用户定案：必须动 Daemon，动了收益比回头收改要大）。三件：按 Agent 全量会话列表、跨 Agent 最近活跃会话、Session.title。严格点状变更，大修仍后置。
2. **新会话的 Agent 归属** → **ChatFlow 内建轻量切换器**（源 AgentSwitcher 形态移植，消费 agents 插件经 services 提供的数据）。
3. **四项增强时点** → **三期一次做完**（全量移植 + hero + 四项增强；依赖缺失 RPC 的功能点做 UI 预留并标注挂起）。
4. **保持挂起**：产物视图（Detail，等 .sessions 迁移）、游标压缩占位数据源（等 Daemon 大修）、@ 引用的文件列表 RPC（若无现成协议）。

---

## 附录 A：Token 映射表（desktop → mindx-work，一期定稿）

依据（双侧实证）：desktop `src/renderer/src/assets/main.css` `:root` 段；work `ui-shell-vue/src/styles/tokens.css`。
映射原则：数值相等优先，其次按语义就近；work 缺位的 token 在下表留痕，不得字面硬编码。

### A.1 间距（desktop 4pt 网格 2/4/8/12/16/24/32/48 vs work 4/8/12/16/20/24/32）

| desktop | 值 | work | 值 | 留痕 |
| --- | --- | --- | --- | --- |
| `--space-0` | 2px | （缺位） | — | 就近 `--mx-space-1`(4px)；2px 微间距用 border/gap 表达或就近 4px |
| `--space-1` | 4px | `--mx-space-1` | 4px | 数值等 |
| `--space-2` | 8px | `--mx-space-2` | 8px | 数值等 |
| `--space-3` | 12px | `--mx-space-3` | 12px | 数值等 |
| `--space-4` | 16px | `--mx-space-4` | 16px | 数值等 |
| `--space-5` | 24px | `--mx-space-6` | 24px | 数值等（档位名错位） |
| `--space-6` | 32px | `--mx-space-7` | 32px | 数值等（档位名错位） |
| `--space-7` | 48px | （缺位） | — | 就近 `--mx-space-7`(32px) |

### A.2 字号（desktop 纯 size vs work font shorthand）

work token 为 `font` 简写（含字重/行高），平移时 `font-size` 规则需改写为 `font:` 简写或按语义对位，不逐字面换名。

| desktop | 值 | work | 值（简写） | 留痕 |
| --- | --- | --- | --- | --- |
| `--font-tiny` | 10px | `--mx-font-micro` | 500 10px/14px | 字号等，带字重行高 |
| `--font-xs` | 11px | `--mx-font-caption` | 400 11px/16px | 数值等 |
| `--font-sm` | 12px | （缺位） | — | 就近 `--mx-font-caption`(11px) |
| `--font-md` | 13px | （缺位） | — | 就近 `--mx-font-body`(14px) |
| `--font-lg` | 14px | `--mx-font-body` | 400 14px/22px | 数值等 |
| `--font-xl` | 16px | （缺位） | — | 就近 `--mx-font-heading`(15px) |
| `--font-2xl` | 20px | `--mx-font-title` | 600 20px/28px | 数值等 |
| `--font-mono` | 'JetBrains Mono' | （缺位） | — | 四期终端/代码视图需要时新登记 `--mx-font-mono` |

### A.3 圆角（desktop 六档 vs work 三档）

| desktop | 值 | work | 值 | 留痕 |
| --- | --- | --- | --- | --- |
| `--radius-xs` | 4px | （缺位） | — | 就近 `--mx-radius-control`(8px) |
| `--radius-sm` | 6px | （缺位） | — | 就近 `--mx-radius-control` |
| `--radius-md` | 8px | `--mx-radius-control` | 8px | 数值等 |
| `--radius-lg` | 12px | `--mx-radius-card` | 12px | 数值等 |
| `--radius-xl` | 16px | （缺位） | — | 就近 `--mx-radius-window`(14px) |
| `--radius-full` | 999px | （缺位） | — | 胶囊形保留字面 999px（几何值非颜色，不受军规 3 限制） |

### A.4 颜色语义（军规 3：全量 `--mx-*`，禁字面色值）

| desktop | work | 语义 |
| --- | --- | --- |
| `--bg-primary` | `--mx-bg-window` | 窗口底 |
| `--bg-secondary` | `--mx-bg-surface` | 面板底 |
| `--bg-sidebar` | `--mx-bg-surface` | 侧栏底（desktop 与 secondary 分值，work 合一） |
| `--bg-card` | `--mx-bg-elevated` | 卡片/浮层底 |
| `--bg-tertiary` | `--mx-module` | 输入框/内嵌模块底 |
| `--bg-hover` | `--mx-hover` | 悬停灰底 |
| `--text-primary` | `--mx-text` | 主文字 |
| `--text-secondary` | `--mx-text-secondary` | 次级文字 |
| `--text-muted` | `--mx-text-tertiary` | 三层弱文字（第三档对位） |
| `--accent-cyan` | `--mx-accent` | 品牌主色 |
| `--accent-blue` | `--mx-accent` | 按钮底（work 单品牌色语义，按钮/accent 同源） |
| `--accent-purple` | （缺位） | work 无第二品牌色，就近 `--mx-accent`；需视觉区分处用 color-mix 派生 |
| `--success` | `--mx-success` | 成功 |
| `--warning` | `--mx-warning` | 警告 |
| `--danger` | `--mx-danger` | 危险 |
| `--info` | `--mx-business` | 信息/业务蓝 |
| `--border-color` | `--mx-separator` | 常规描边（弱描边用 `--mx-separator-soft`，强描边 `--mx-border-strong`） |
| `--gradient-start` / `--gradient-end` | （缺位） | work 无渐变 token；渐变退化为单色 `--mx-accent` 或 color-mix 派生 |
| `--overlay` / `--overlay-soft` / `--overlay-light` | `--mx-mask` | 遮罩（desktop 三档，work 单档 0.24） |
| `--shadow` / `--shadow-light` / `--shadow-deep` | `--mx-shadow-panel` / `--mx-shadow-prominent` / `--mx-shadow-lv3` | 按浮层用途就近 |
| `--terminal-bg` / `--terminal-fg` / `--terminal-cursor` | （缺位） | 四期终端视图随用随登记 |
| `--el-*` 系列 | 不平移 | Element Plus 全局覆盖是 desktop 主仓 hack；work 壳已全局装配 EP |

## 附录 B：图标映射表（→ Iconify lucide 集合，一期定稿）

依据（双侧实证）：desktop `tree/registry/summary.ts` / `actions.ts`（Element Plus 图标 + icons.ts 自绘 SVG）与 work `plugins/src/chatflow/tree/registry/` 两表（已落地）。统一渲染 `<MxIcon name="lucide:xxx" :size="16|20" />`，禁 mdi 与 @element-plus/icons-vue。

### B.1 registry/summary.ts（32 节点类型）

| 类型 | desktop 源 | work lucide |
| --- | --- | --- |
| content | Document | `lucide:file-text` |
| thinking | Opportunity | `lucide:lightbulb` |
| group | FolderOpened | `lucide:folder-open` |
| task | Tickets | `lucide:ticket` |
| team | UserFilled | `lucide:user` |
| subagent | RobotIcon（icons.ts 自绘） | `lucide:bot` |
| collect | Box | `lucide:box` |
| permission | Lock | `lucide:lock` |
| ask_user | ChatDotRound | `lucide:message-circle` |
| error | CircleCloseFilled | `lucide:circle-x` |
| compaction | Sort | `lucide:arrow-down-up` |
| max_turns | Warning | `lucide:triangle-alert` |
| llm_retry | RefreshRight | `lucide:rotate-cw` |
| cancelled | CircleClose | `lucide:circle-off` |
| tool.read | Document | `lucide:file-text` |
| tool.write | DocumentAdd | `lucide:file-plus` |
| tool.edit | EditPen | `lucide:file-pen` |
| tool.ls | FolderOpened | `lucide:folder-open` |
| tool.glob | Files | `lucide:files` |
| tool.grep | Search | `lucide:search` |
| tool.bash | TerminalIcon（icons.ts 自绘） | `lucide:square-terminal` |
| tool.run_script | VideoPlay | `lucide:play` |
| tool.web_fetch | Link | `lucide:link` |
| tool.web_search | GlobeIcon（icons.ts 自绘） | `lucide:globe` |
| tool.kb_search | Collection | `lucide:library` |
| tool.memory_search | Cpu | `lucide:cpu` |
| tool.skill | MagicStick | `lucide:sparkles` |
| tool.sleep | Timer | `lucide:timer` |
| tool.task_query | Tickets | `lucide:ticket` |
| tool.team_ops | UserFilled | `lucide:user` |
| tool.cron | AlarmClock | `lucide:alarm-clock` |
| tool.notify | Bell | `lucide:bell` |

### B.2 registry/actions.ts（21 操作，实际带图标 17 项）

| 操作 id | desktop 源 | work lucide |
| --- | --- | --- |
| copy | CopyDocument | `lucide:copy` |
| speak | VideoPlay | `lucide:volume-2` |
| download-md | Download | `lucide:download` |
| save-project | Link | `lucide:link` |
| open-tasks | List | `lucide:list` |
| open-subsession | TopRight | `lucide:arrow-up-right` |
| details | InfoFilled | `lucide:info` |
| view-qa | ChatDotRound | `lucide:message-circle` |
| retry | RefreshRight | `lucide:rotate-cw` |
| ignore | Close | `lucide:x` |
| open-settings | Setting | `lucide:settings` |
| reveal | FolderOpened | `lucide:folder-open` |
| copy-command | CopyDocument | `lucide:copy` |
| rerun | Refresh | `lucide:refresh-cw` |
| open-script-dir | FolderOpened | `lucide:folder-open` |
| open-url | TopRight | `lucide:arrow-up-right` |
| open-skill-doc | Document | `lucide:file-text` |
| open-schedule | AlarmClock | `lucide:alarm-clock` |

无图标操作（desktop 亦无）：rollback、open-file-at。

### B.3 装配件（一期新增，无 desktop 源）

| 位置 | work lucide |
| --- | --- |
| Sidebar Tasks 节图标 | `lucide:list-todo` |
| Sidebar「新会话」行 | `lucide:plus` |
| ChatFlowPage 空态 | `lucide:message-square-text` |

## 附录 C：四期勘察结论（2026-09-26 实证，协议对准唯一依据）

### C.1 Daemon 配合项现状（重大偏差：三件中两件半已存在）

| 配合项 | 现状 | 证据 |
| --- | --- | --- |
| ① 按 Agent 全量会话列表 | **已存在**：`session.list` 参数 `{agent?}` 过滤 | mindx/internal/svc/handler_session.go L15-42；pkg/rpc/session.go L18-20 |
| ② 跨 Agent 最近活跃 | **已存在**：`session.latest_by_dir {project_dir}`；且 `session.list`（无参）返回全量、按 LastActivityAt 倒序（file_store.go L358-394），Tasks「最近讨论」直接前端排序即可 | handler_session.go L47-82 |
| ③ Session.title | **读取已存在**（SessionInfo.Title ← meta.json）；自动补录已有（首条 user 消息截断 80 字，file_store.go L178-188）；**用户编辑 RPC 缺**（desktop 亦无编辑入口）→ 四期补 `session.rename`（点状：LoadSessionMeta + SaveSessionMeta 已有，meta.go/file_store.go L187） | pkg/session/file_store.go L452-480 |

LLM 提炼 title：desktop 从未实现（无先例可对准），涉 Runtime 主链路，**挂起**（非点状变更）。会话 title 展示与编辑用现有自动补录数据。

### C.2 daemon RPC 可用面（handler_registry.go 实证，chatflow 可直连）

`fs.write_base64` / `fs.read_base64` / `fs.list` / `fs.read` / `fs.stat` / `optimize.rpc` / `translate.rpc` / `model.list` / `model.switch` / `provider.list` / `agent.list` / `message.cancel` / `session.create|get|list|latest_by_dir|context|truncate|delete_round|compact|delete|meta|confirm_files|rollback_files` / `schedule.list` / `token.usage.*` 全部已注册。三期打桩的图片落盘（fs.write_base64）、输入优化（optimize.rpc）、停止（message.cancel）均有真通道，无需 desktop 主进程。

### C.3 协议对准（desktop 消费面实证）

- **发送**：`user.message`（notification 非 call），参数 `{text, session_id?, job_entry_id?, job_run_id?, images?: [{path, media_type}]}`（desktop services/websocket.ts L156-184）。
- **事件通知**：JSON-RPC notification，`params = {type, session_id, title, data, meta}`；`method ≡ type`（相同），订阅按 method；`agent_name` 在 `meta.agent_name`。work DaemonSocket.onNotification(method, cb) 直接同构可用（cb 收 params 对象）。
- **事件全族**（connectionStore.ts L631-944 订阅清单）：user_message_saved / message_queued / message_processing / thinking_delta / thinking_done / markdown / content_delta / tool_use_delta / tool_exec_start / tool_exec_end / subtask_spawned / subtask_completed / ask_user_request / final_answer / permission_request / permission_denied / form / execution_summary / token_usage_recorded / loop_end / task_summary / error / context_usage / compact_start / compact_done / max_turns_reached / llm_cancelled / llm_retry / file_modified / schedule.job_* / agents_changed / skills_changed。
- **归一要点**（chatStore.ts L1301-2300）：content_delta 经 `pendingContentBySession` 累积 120ms 节流合并追加；tool_use_delta 缓存 arguments 待 start 合并；tool_exec_start 建 tool_exec 消息（eventData.start）、tool_exec_end 按 tool_call_id 更新 status=done/failed；loop_end 仅 `termination_reason=completed` 置 sessionLoopEnded（轮收拢判定）；file_modified 不进消息流（pendingFileModificationsBySession 供文件审查条）；error/llm_retry/max_turns_reached 各产生对应系统消息。
- **历史 restore**（chatStore.ts L553-680）：session.get 返回 `{session_id, messages, meta, modify_files}`；SessionMessage[] 中带 tool_calls 的 assistant 消息不直接进列表，role=tool 结果按 tool_call_id 归位，CollectResults 收集，tool 轮 token_usage 并入最终回复消息；子会话流 = 主流 subtask_spawned.eventData.session_id ∪ localStorage subtask 登记，逐个 session.get 后 restore（prefetchSubagentStreams L2031-2071）。
- **阻塞交互**：授权回复走**魔术词**经 user.message——`PermissionAllow[: <sid>]` / `PermissionAllowSession[: <sid>]`（记住授权）/ `PermissionDeny[: <sid>]`；子会话授权发往 sponsor 主会话（subSessionSponsor 映射）；ask_user 主会话回答 = 普通用户消息，子会话回答 = user.message 带子会话 session_id（answerSubagentAsk chatStore.ts L2023）。
- **重试/回退**：重试 = `session.truncate {session_id}`（截到最后一条 user 消息）+ 重发；回退轮 = `session.delete_round {session_id, id}`；context ring = `session.context {session_id}` → `{window_tokens, max_window_size, usage_ratio, ...}`。
- **会话列表同步**：`session.list {agent?}` → ServerSessionInfo[] `{session_id, agent_name?, title?, project_dir?, session_dir?, last_activity_at, created_at}`（无 message_count 字段——desktop Session.message_count 前端自增）。

### C.4 四个 UI 源件（desktop src/renderer/src/components/chat/）

| 件 | 形状 |
| --- | --- |
| PermissionBar.vue（416 行） | props：toolName/reason/securityLevel（low/medium/high）/sessionId/disabled；emits：grant `{tool_name, remember, session_id}`、deny `{reason, session_id, tool_name}`；魔术词由宿主发 |
| AskUserView.vue | props：formData（ask_user 事件 eventData）+ targetSessionId（子会话冒泡区分）；回答 emit submitted，宿主经 sendMessage / answerSubagentAsk 通道 |
| SkeletonChat.vue（139 行） | el-skeleton 骨架（用户/助理占位气泡），无 props 依赖 |
| AgentSwitcher.vue | 数据：connectionStore.agents（agent.list）过滤已雇佣（hired）；切换 emit 给宿主 |

### C.5 work 承接面

- `daemon.connection`（connection/runtime.ts L48-65）：`state/lastError/mode/remoteUrl` + `call<T>(method, params, timeoutMs=60000)` + `onNotification(method, cb(params))`；services.use 未注册即抛错（启动期暴露）。
- agents/models 插件**未 provide services**（数据归各自 store）；按决策点 2，agents 插件补 provide 轻量服务（agent 列表）供 chatflow 消费。
- chatflow 现无 store.ts（一至三期 fixture + props 注入），四期新建；`useService` 消费先例 skills/store.ts L50-60。
