# 链接全接管 + video-viewer 视频播放插件落地

日期：2026-09-30
涉及：plugins/src/video-viewer/（新三件套）、web-viewer/index.ts、chatflow/store.ts、chatflow 4 个视图、explorer/TreeNode.vue、ui-shell/src/desktop-bridge.ts、electron/src/{main,preload,navigation,file-stream}.ts（后两个新建）、plugins/package.json、plugins/src/index.ts、app/src/main.ts

## 事实

- **链接全接管三层结构**：
  1. 渲染侧清零：4 处 `window.open` / `target="_blank"` 泄漏点全部改路由——UserMessageRow `previewImage` 改 `store.openFile(img.path)`（进 image-viewer，语义正确家）；useNodeActions `open-url` 动作、WebFetchNodeView、WebSearchNodeView 链接改 `chatStore.openUrl`（`@click.prevent` 拦默认行为）。
  2. 主进程兜底网（electron/src/navigation.ts）：`setWindowOpenHandler`（含 iframe 内 target=_blank 上抛）全 deny + `will-navigate` 拦外跳，web 链接经 `webContents.send('mx:open-url', url)` 回发；仅放行自身页面（MX_DEV_URL origin / file:// 产物）。
  3. web-viewer/index.ts 装配期 `window.mxDesktop?.onOpenUrl(cb)` 消费，闭包持 `createWebViewerService()`（getter 运行期解析 store，回调时 Pinia 必已装好）；停用清理退订。
- **mx-file:// 流式协议**（electron/src/file-stream.ts）：`registerSchemesAsPrivileged` 在模块加载期声明（多次调用是追加语义，mx-plugin/mx-file 分文件各自声明均生效）；`protocol.handle` + `statSync` + Range 头手动解析（`bytes=start-end` / `bytes=-suffix` 两形态 + 416 越界）→ `createReadStream` + `Readable.toWeb` 返回 206/200；扩展名→MIME 表。`<video>` seek 即点即放靠 Range，base64 整读不可行。
- **video-viewer 插件**：Detail order 105（image 103 / doc+web 104 / video 105 段位续接）；store `open(path)` 同步无取数（流地址即开即播）；DetailPanel `:key="srcUrl"` 强制重建 video 元素换源 + `@error` 解码失败错误态（avi/flv 等容器浏览器不解码，仍路由进来给提示好于落回 explorer）。
- 接线清单与 docpreview 范式完全一致：chatflow VIDEO_EXTS + openFile 分支、TreeNode videoSvc、package.json exports 子路径、plugins/src/index.ts re-export、app/src/main.ts 装配数组。
- preload 桥新增 `onOpenUrl(listener): () => void`（退订函数），类型定稿在 ui-shell/desktop-bridge.ts MxDesktopBridge。

## 技巧与坑

- **encodeURI 不编码 `#`**：文件路径转 mx-file URL 必须 `path.split('/').map(encodeURIComponent).join('/')`（encodeURIComponent 才编码 #/?/% 结构字符）；encodeURI 会把含 # 文件名的路径截断成 fragment。
- `Readable.toWeb(node流)` 返回 node:stream/web 的 ReadableStream 类型，与 DOM ReadableStream 类型不兼容，需 `as unknown as ReadableStream` 双重断言。
- setWindowOpenHandler 拦截 deny 后，iframe 内 target=_blank 链接不会再弹系统窗口——回发渲染层的路由闭环正好覆盖 web-viewer iframe 内的"新开页签"诉求。
- 插件停用后主进程兜底回发无人消费 = 静默不开窗（可接受降级，不炸不 toast，因为主进程不感知插件状态）。
