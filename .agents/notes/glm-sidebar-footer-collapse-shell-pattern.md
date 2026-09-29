# Sidebar Footer 折叠：壳机制扩展与 grid 0fr 折叠技巧

日期：2026-09-29
涉及：ui-shell/src/createApp.ts、ui-shell-vue/src/components/SidebarPane.vue

## 事实

- 壳机制状态模式（createApp.ts）：内部 `let xxx = false` + getter + toggle 方法 + `hub.bump()`，无持久化（sidebarCollapsed/contentCollapsed/footerCollapsed 三者一致）；适配器经 useShellData 消费。
- Sidebar Footer 区是插件席位（addFooter）：calendar(90) → usage(91) → memory/diffview → chrome-footer(设置,100)；折叠整个 Footer 属壳布局职责，归 SidebarPane，不在任何插件内实现。
- footer 行几何先例（UsageFooterRow）：42 高 / margin 4 -2 / padding 0 12 / radius control / secondary 墨色 / hover 实底 --mx-bg-surface（darwin 半透明侧栏需实底 hover 才可辨）。

## 技巧

- 纯 CSS 高度折叠动画：grid-template-rows 0fr→1fr 过渡 + 内层 `min-height:0; overflow:hidden`；visibility 同步过渡（折叠延迟 hidden、展开立即 visible）保证折叠后按钮焦点不可达。
- ui-shell（框架包）改动 HMR 不生效，CDP 验证前需 page.reload()。
- 已知微小代价：footerClip overflow hidden 会裁掉 footer 行 margin -2 的 2px 横向出血，hover 背景比原窄 2px，视觉几乎无感（实测截图确认无违和）。
