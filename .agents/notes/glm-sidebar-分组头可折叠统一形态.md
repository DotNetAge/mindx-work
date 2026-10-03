# Sidebar 分组头「可折叠头」统一形态

日期：2026-10-03
涉及：ui-shell-vue/src/components/SidebarPane.vue、plugins/src/chatflow/sidebar/TasksSection.vue、plugins/src/dashboard/SidebarSection.vue

## 事实

- 用户定稿（2026-10-03 截图批注）：Sidebar 出现分组栏时，分组标题不能只是静态文字——整行可点击，操作整个分组的折叠与展开；折叠指示 chevron 靠行右缘（不是左侧）；Sidebar 滚动区不显示滚动条。
- 用户二次定稿（2026-10-03 第二张截图四条批注，适用于一切分组头含壳 footerToggle）：
  1. **分组头字体必须一致且用小字**（`--mx-font-caption`）——壳 sectionTitle 与 footerToggle 原为 body 已改 caption；
  2. **分组头上下留白增大**（`margin: var(--mx-space-2) 0 var(--mx-space-1)`；有分隔线的区覆盖 margin-top: 0 防双重叠加）；
  3. **右侧折叠指示默认隐藏，hover/键盘聚焦才显现**（opacity 0→1 过渡）；折叠 rail 态无文字仅指示，恒显；
  4. **分组头无背景**——hover/active 一律不铺底色（壳 footerToggle 原 darwin 实底 hover 定稿作废），hover 反馈 = chevron 显现 + 文字加深（--mx-text-secondary → --mx-text）。
- 统一形态三件套（三处实现完全一致，后续新分组头照抄）：
  1. 分组头用 `<button>`（键盘可达），标题左、计数徽章紧跟、chevron `margin-left: auto` 靠右；
  2. chevron 折叠态 `rotate(-90deg)`（朝右）、展开朝下，`transform` 过渡；
  3. 行列表包进 grid 0fr→1fr 折叠体（`groupBody[data-collapsed]` + 内层 `min-height:0; overflow:hidden; visibility` 过渡），与壳 footer 折叠同技巧（见 glm-sidebar-footer-collapse-shell-pattern.md）。
- 折叠状态一律组件内存态（ref Set/boolean），不持久化——与壳 footerCollapsed 同策略。
- 侧栏滚动区藏滚动条两行：`scrollbar-width: none` + `&::-webkit-scrollbar { display: none }`；滚动能力保留。范围 = SidebarPane `.scroll`、TasksSection `.root`、dashboard SidebarSection `.root`（CalendarView 的 overflow 是表单弹层内部，不属于 Sidebar，勿误改）。
- button 不继承字体：分组头 button 化后 `font: var(--mx-font-caption)` 必须搬到 button 上（原来在内部 span 上）。
- ui-shell-vue 是框架包，改动 HMR 不生效，验证前 page.reload()（老结论，本轮再次适用）。

## 技巧

- CSS Modules 下 `.root::-webkit-scrollbar` 本地类 + 伪元素编译无损，curl dev server style 子模块已核对产物。
- 「最近讨论」捷径区折叠键用保留前缀 `__recent__`，避免与工作目录名（分组标签）撞键。
