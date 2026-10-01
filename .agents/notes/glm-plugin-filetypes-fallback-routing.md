# 文件类型接管路由（fileTypes 反转 + codeeditor 兜底）

日期：2026-10-02 ｜ 触发：工具调用 ≥10 次 + 架构决策

## 背景与决策

原路由是两份硬编码扩展名集合（explorer/TreeNode 七个 Set + chatflow 六个 Set + 共享 fileExts.ts），出现"chatflow 能开 .ts、文件树不能"的漂移。用户拍板反转方案：

- **壳层新增第七通道 `ctx.fileTypes`**（ui-shell/src/fileTypes.ts）：`register(exts, serviceId)` 返回摘除函数（重复注册抛错，启动期暴露冲突），`serviceOf(ext)` 查询。市场插件装入即注册、停用即摘除，路由代码零改动。
- **六个查看器插件装配期各声明接管扩展名**（markdown/image-viewer/docpreview/video-viewer/svgboard/kanban；codeeditor 不注册——兜底地位）。
- **路由反转**：TreeNode 与 chatflow openFile 均为"注册表命中 → 声明插件；未命中 → codeeditor 兜底"。fileExts.ts 已删除。
- **二进制甄别放 codeeditor.open 内部**（NUL 字节启发式：`content.slice(0,8192).includes('\u0000')`，VS Code 同思路），命中即 `handOffBinary` → `window.mxDesktop.openPath` 转系统默认程序，无宿主桥则提示。路由方保持无脑。

## 验证要点（CDP，port 9333）

- explorer-store 有 `setWorkspace(dir)` action，可直接指向沙盒目录渲染文件树。
- **文件树与 codeeditor 同在 Detail 轨道竞争**：点文件打开 codeeditor 后文件树行全部消失——每个用例前需重新点 `[title="打开当前工作目录"]` + setWorkspace 恢复（幂等）。
- **CodeMirror `.cm-content` 有上一个文件的残留内容**，"二进制未入编辑器"不能拿 DOM 文本断言，必须查 `codeeditor-store.currentFile` 是否未变。
- 纯 Web（localhost:5273）无 `window.mxDesktop.openPath`，handOffBinary 走 else 提示分支；桌面壳才真实转系统。

## 结果

typecheck EXIT=0；文件树链 8 断言 + chatflow 链 5 断言全过（/tmp/ft_verify.py、ft_verify2.py）。

## 教训

- Edit 工具 old_string 尾部带换行、new_string 不带时会把下一行 import 拼接进同一行——删除 import 行后必须目检相邻行。
- 模板里也可能引用路由 Set（TreeNode 文件图标用了 MARKDOWN_EXTS/IMAGE_EXTS），删 Set 前先 grep 模板引用，纯视觉分支改字面量。

## 追加（同日）：explorer 卡「正在定位工作目录」——与 fileTypes 改动无关的存储层重复副本

用户报"改后 explorer 永远卡在正在定位工作目录"。排查链路（全部 CDP 实证）：

1. 空态 = `store.rootDir` 为空（DetailPanel v-if hint）；手动 `setWorkspace` 立即生效 → explorer store 与新路由代码无辜。
2. 根因：`chatflow.currentProjectDir` 为空。当前活跃会话 `project_dir=null`——**同一 session_id 在磁盘有两份**：`~/.sessions/assistant/<id>`（ProjectDir 空，较新）+ `~/.sessions/architect/<id>`（dir=/Users/ray，较旧）。
3. 源头：mindx `RoutedSessionStore.ListSessions`（routed_store.go L292）按分片 union 不去重；`FileSessionStore` 按 `{root}/{agent}/{sessionID}` 归档，跨 agent 目录的重复副本各自成条。前端 `loadSessions` 原样映射 → `switchToSession` 的 `find` 命中排前的空 dir 副本 → 工作目录不就位。
4. 修复双层：daemon `handleSessionList`（handler_session.go）同 id 去重（ProjectDir 非空优先，其次 LastActivityAt 新，保留活跃度倒序）；前端 loadSessions 同规则去重（Map 保序）作防御。go build + typecheck 过，CDP 验证 14 条会话无重复、活跃会话 dir=/Users/ray、explorer 树渲染正常。
5. daemon 改动需重启 daemon 才生效；前端防御 reload 即生效（本次验证即在前端修复下通过）。

**可复用诊断手法**：Pinia 桥读 `chatflow-store.sessions` 按 session_id 分组找重复副本，直接暴露 `session_dir` 磁盘路径——比读 daemon 代码猜布局快得多。"组件显示加载空态"先区分三种根因：组件树渲染崩溃（console error）、store action 未被调（桥上手动调一次）、上游数据异常（查数据源），手动调用生效即排除前两者。

## 追加：Detail 条目理想宽（preferredWidth 宽度仲裁）

需求：explorer 窄轨道打开 markdown/codeeditor 时 Detail 自动拉宽。方案（用户拍板方向）："激活谁用谁的宽"——DetailEntry 加可选 `preferredWidth`（ui-shell/src/views.ts），DetailPane 统一宽度仲裁 `applyIdealWidth()`：openMax 拉满 > preferredWidth（clamp 到 WIDTH_MIN 与平分上限）> 壳缺省 320；watch 激活条目切换触发（同条目无实义变化跳过，保住拖拽结果）；width 加 CSS transition（拖拽态 .dragging 已禁过渡不冲突）；双击手柄重置改为回本条目理想宽。声明值：markdown/codeeditor/docpreview/diffview 760、image-viewer 460；video-viewer/svgboard 保持 openMax。

**验证坑**： explorer 面板与 codeeditor 同在 Detail 轨道——`ensure_tree()`（点"打开当前工作目录"）会把激活层切回 explorer，此时测拖拽/双击得到的是 explorer 层（无声明 → 320 = WIDTH_DEFAULT），不是被测插件层。层内行为验证必须在 `click_row` 后直接做，中途不得重新唤起文件面板。拖拽 320→240 的 FAIL 是 WIDTH_MIN clamp 的正确行为，不是 bug。

## 追加：legacy-modes 全量语法高亮（176 扩展名）

ui-shell-vue/src/codemirror.ts 双段映射：官方 lang-* 31 扩展名优先 + @codemirror/legacy-modes@6.5.4 全量 100 解析器 / 145 扩展名（StreamLanguage.define 包装）。语言判定验证手法：`.cm-content` 内 `span[class]` 数量——纯文本 ≈0，有高亮 3~8。

**坑**：
- StreamLanguage 在 `@codemirror/language` 不在 `@codemirror/state`（TS2305 即暴露）
- 批量提取 d.ts 导出名的脚本有误报（eiffel 报 "e" 实为 "eiffel"）——**typecheck 才是导出名的最终核对器**，TS2305/TS6133 会揪出全部错误导入名与漏用键，不要信手工扫描
- legacy-modes 6.5.4 目录是平铺 `mode/<name>.d.ts`（非 `mode/<name>/<name>.d.ts`），探包先 ls 确认
- 无公认扩展名的模式不硬造映射（asterisk/solr/spreadsheet/nginx）；Elixir/Zig/GraphQL 不在 legacy-modes 内，暂无高亮
- 编写大映射表时严禁写"占位键/演示键"（本次曾误写 `ex: legacy(crystal)` 这类错误映射，靠自查重写清除）
