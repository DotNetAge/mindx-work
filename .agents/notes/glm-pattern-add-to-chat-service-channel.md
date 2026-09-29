# 跨插件「添加到对话」通道模式（服务壳 + defineExpose 桥）

日期：2026-09-29

## 结论

mindx-work 里把资源（文件/目录）追加进对话输入框引用 chip 的跨插件通道，定式为三层：

1. **ChatInput**（chatflow/input/index.vue）：新增 `appendFileRef(refAttrs: FileRefAttrs)` 并
   `defineExpose`——内部 `focus('end')` + `insertFileRef`（chip 数据由调用方给，目录标记
   直接取 FSEntry.is_dir，无需再 stat RPC）。
2. **chatflow 服务壳**（store.ts 尾部）：模块级 `appendFileRefHandler` 持有人 +
   `registerAppendFileRefHandler(fn|null)` 登记/注销；`createChatflowService()` 增加
   `appendFileRef(ref): boolean`（未登记返回 false，调用方提示）。
3. **ChatFlowPage**：setup 时登记 `(ref) => chatInputRef.value?.appendFileRef(ref)`，
   `onBeforeUnmount` 注销；hero 与消息流两形态 ChatInput 共用同一 `ref="chatInputRef"`。

消费方（explorer DetailPanel）按契约本地声明最小形状，不跨插件 import。

## 关键事实

- ContentPane 是单活动视图（`v-if`，无 KeepAlive）：ChatFlowPage 随 Content 切换会卸载，
  服务壳必须在未登记时返回 false 而不是崩/静默成功。
- hero / 消息流两形态 `v-if`/`v-else` 互斥，同一个 ref 名绑定即可，handler 运行期解引用。
- explorer 右键菜单位置：用户截图标注「添加到对话」在「刷新」下方（菜单最底部），
  仅资源条目显示（空白右键=根目录，无此菜单项）。
- 壳层 Detail 轨道默认收起：CDP 验证前先点 Toolbar 的「打开当前工作目录」按钮
  （aria-label 匹配）拉出 explorer，`explorer.open(dir)` 内部会拉出 Detail。

## 验证套路

`pnpm typecheck` + CDP（electron 9333）四步探针：状态（rows/hasChatInput/chipsBefore）
→ 右键文件行（mouse.click button=right）→ 菜单文本断言 → 点菜单后查
`.chat-input-area [data-type="file-ref"]` 的 title/isDir。脚本模板：/tmp/mx_add_to_chat_verify.py。

## 坑：work 无文件图标主题 CSS（2026-09-29 追加）

desktop 的 chip/LangBadge 图标靠 monaco-vscode-api 加载的文件图标主题 CSS（mindx-material-icons，
themes/themeExtension.ts 注册）渲染 `.show-file-icons .xxx-name-folder-icon::before`；work 无
monaco 依赖，该 CSS 整体缺失（全局 0 条 folder-icon/ext-file-icon 规则），`computeIconClasses`
产出的 class 无消费者 → 引用 chip 无图标（用户截图报「少了图标，文件或文件夹」）。

修复：input/index.vue 给 `.file-ref-icon.folder-icon` / `.file-icon:not(.folder-icon)` 加
lucide 线性 SVG 的 CSS mask（currentColor 上色），只兜底目录/文件两枚，name/ext 细分留待
主题体系落位。**同类隐患**：LangBadge / TreeView 挂同样 class，同样无图标——用户未报，未动，
后续如报按同一 mask 方案处理。

测试侧坑：CDP 派发右键前若 `elementFromPoint` 命中 `_mask_` 浮层（如设置对话框开着），
物理 mouse.click 会被挡（菜单不弹），改用 `dispatchEvent(new MouseEvent('contextmenu'))` 绕过。
