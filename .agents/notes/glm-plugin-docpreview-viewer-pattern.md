# docpreview 文档预览插件落地 + 查看器插件范式清单

日期：2026-09-30
涉及：plugins/src/docpreview/（新，store/DetailPanel/index 三件套）、chatflow/store.ts、explorer/TreeNode.vue、plugins/src/index.ts、plugins/package.json、app/src/main.ts

## 事实

- daemon 已有 `fs.read_base64` RPC（返回 `{ content, mime }`），UI 侧 `daemon.call` 直接消费；二进制文件（图片/PDF/Office）统一走它。
- **查看器插件范式**（照抄 image-viewer，新查看器按此清单装配）：
  1. `plugins/src/{name}/` 三件套：`store.ts`（bindXxxShell 装配期捕壳 + `defineStore` + `open()` 末尾 `theShell().Detail.show(ID)` + `createXxxService()` 延迟外壳——装配期 Pinia 未装禁止建 store）、`DetailPanel.vue`、`index.ts`（`ctx.Detail.add` + `ctx.services.provide('{name}.store', ...)`）。
  2. 消费侧（chatflow/explorer）**禁止跨插件 import**，用 `serviceOf<OpenerService>('xxx.store')` / `useService` 本地最小形状声明，缺失降级 toast。
  3. 扩展名路由有两处要同步加：`chatflow/store.ts` openFile（L2548 起）与 `explorer/TreeNode.vue` onClick（L145 起）。
  4. `plugins/package.json` 的 `exports` 必须加子路径映射（`"./docpreview": "./src/docpreview/index.ts"`）——漏加时 app import 报 TS2307 且包根类型推断级联崩（AppShell 泛型变 unknown 不匹配 VueAppShell）。
  5. `plugins/src/index.ts` re-export + `app/src/main.ts` import 并加入 `createApp([...])` 装配数组。
- 渲染选型：PDF = base64→Blob→`URL.createObjectURL`→iframe（Chromium 内置查看器，零依赖）；docx = docx-preview `renderAsync(data, box)`；xlsx = SheetJS `read` + `sheet_to_html`（数据级预览）；pptx = pptx-preview（运行时探测 `init` 工厂，失败降级提示）。三库动态 import 均被 vite 代码分割（pptx-preview 单独 chunk 1.25MB）。
- **「添加到对话」按钮（五个查看器统一，2026-09-30 四轮）**：席位 = `ctx.Detail.addToolbar({ id: '{name}-detail-addchat', owner: <Detail条目id>, component: AddToChat })`（owner 归属——激活该查看器才显示；**必须先 Detail.add 再 addToolbar**，views.ts 启动期校验归属存在）；行为 = `useService<ChatflowServiceLike>('chatflow.store')`（setup 顶层 try-catch 捕获，服务缺失/对话页未挂载 appendFileRef 返回 false 两条降级 ElMessage）→ `appendFileRef({ path })` 追加 Tiptap FileRef 引用 chip 进输入框（纯文本序列化，出站消息即路径/URL）。
- **「添加到对话」禁止复用 PendingFileMod**：pendingFileModificationsBySession 是 Agent 改动回执的"待确认修改"数据面（diff/additions/deletions），且 setPendingFilesFromServer 整体替换语义（以服务器为准）会在会话加载时清掉手工条目。用户主动引用文件走 appendFileRef 通道（explorer DetailPanel ctxAddToChat 先例）。
- **组件态暴露给同插件其它组件用"serializer 登记"模式**：serialize 依赖 DetailPanel 内部 shapes/vb 时，store 加 `serializer = ref<(() => string) | null>(null)`，面板 onMounted 登记 onUnmounted 注销，按钮组件经 store 调用（svgboard「添加到对话」先落盘再引用：dirty || !currentFile 时先 save(serializer())）。

## 技巧与坑

- **TS 5.7 严格 ArrayBuffer**：`new Uint8Array(len).buffer` 类型是 `ArrayBufferLike`（含 SharedArrayBuffer），赋给 `ArrayBuffer` 字段或进 `Blob([...])` 报 TS2322。解法：工具函数返回标注 `Uint8Array<ArrayBuffer>`（`new Uint8Array(n)` 实际就是该类型）。
- SheetJS `wb.Sheets[name]` 类型是 `WorkSheet | undefined`（TS strict），需判空。
- Detail 席位 order：image-viewer 103、docpreview 104、web-viewer 更后；预置插件保留段 1–1000。
