# 四路分片审计清单

每片 = 一份子代理任务书。任务书按"范围 → 对照条款 → 检查项 → 已知坑 → 输出格式"组装；输出格式统一为：**分档（缺陷/风险/观察）+ 文件：行号 + 触发条件 + 后果链**。

---

## 分片一：ui-shell 内核（渲染无关层）

**范围**：`ui-shell/src/` 全部（changes.ts / registry.ts / views.ts / createApp.ts / services.ts / types.ts / plugin-manifest.ts / desktop-bridge.ts）

**对照条款**：contract.md §2-§12（通用条目模型、八区 API、版本通知、启动期校验）

**检查项**：

- 并发与一致性：共享数组/集合是否暴露本体（必须快照语义，getter 逐次求值）；事件投递是否先复制订阅者再遍历 + 单订阅者异常隔离（一个抛错不中断其余）
- 校验顺序：**先校验后赋值**——非法输入不得污染机制状态（如 show(id) 校验失败时 activeTabId 必须原样）；抛错路径不得留下半程状态
- 状态机：活动指针（activeId / activeTabId / shown / isOpen / sidebarCollapsed）写入点唯一（壳唯一写）；回退路径完备（remove 活动条目后回落 order 最小条目；初始指针不被注册顺序影响）
- 契约符合性：API 面与 contract.md 逐字段比对——多了、少了、语义漂移都是发现
- 构造函数返回 error 而非静默 panic；必传参数非空检查

**已知坑**（复发即缺陷）：

- registry `entries` 曾返回内部数组本体：remove 换新数组后旧持有者永远读旧数据且无任何报错
- bump 曾无异常隔离：单订阅者抛错中断其余订阅者通知
- Detail.show 曾先赋值后校验：非法 id 污染 activeTabId
- Content 初始指针曾在 add 时固化：装配注册顺序影响初始页（契约：未选择时动态回退 order 最小）

---

## 分片二：ui-shell-vue 渲染层

**范围**：`ui-shell-vue/src/`（components/ 八区组件、styles/ controls.css + tokens.css、reactivity）

**对照条款**：contract.md §14（浮层层级表 + Esc 分层）+ mx-uikit 军规（--mx-* token、伪类全量显式、禁字面色值）

**检查项**：

- 事件监听生命周期：全局 keydown / pointer 监听必须 onMounted 注册 + onUnmounted 注销（成对）；多层浮层响应同一按键时必须分层——最上层用**捕获期监听 + stopPropagation**，禁止双层同响应（对照 §14 Esc 分层）
- 指针交互：拖拽类 pointerdown 必须配套 pointerup **和 pointercancel**（手势被系统接管时不卡死、监听不泄漏）；拖拽手柄 z-index 须高于相邻 dragBand（对照 §14 层级表：手柄 6 > dragBand 5）
- 样式军规：字面色值扫描（rgb/rgba/hex 字面量；token 定义处除外）；伪类全量显式——每个交互类逐一核对 :hover / :active / :focus-visible / :disabled 四件套
- 响应式链路：凡读壳数据必经 useShellData；对象字面量固化 getter 转发（`entries: registry.entries`）是缺陷不是风格问题

**已知坑**：

- SettingsPane Esc 曾无分层：modal 在前时按 Esc 连关两层（modal 应捕获期先关并阻断）
- Sidebar/Detail resizer 曾 z-index 1：顶部 48px 手柄条被 Content dragBand（5）盖住无法抓取
- 拖拽曾缺 pointercancel 监听
- darwin vibrancy 与菜单近不透明底曾写字面色值（已 token 化：--mx-wash-blue / --mx-wash-mauve / --mx-menu-bg-opaque）

---

## 分片三：plugins + app 编排层

**范围**：`plugins/src/`（market store、各插件）、`app/src/`（loader.ts、装配入口）

**对照条款**：contract.md §10（services 双形态）、§12（激活期复调）、§18.5（加载管线与活动指针）

**检查项**：

- 异步时序：动作入口全局防重（busy 单飞，busyId 非空即拒）；**先成功后落盘**——激活/远端操作 await 成功后才写持久状态，注释必须与行为一致；失败回滚路径完备（切版/卸载失败重激活旧代际恢复运行期）
- check-then-act：跨 await 的幂等检查必须配在飞 Promise 登记（inflight map），防双跑入口重复注册
- 清理隔离：cleanup() 调用必须 try/catch（坏插件清理函数不卡停用/卸载/回滚/激活失败回滚）
- unhandled rejection：async 函数调用点要么 await 要么 catch；无桥环境（window.mxDesktop 不存在）路径同样不得裸抛
- 激活期校验：插件注册完成后 validateShellConstraints 复调，违规 = 执行清理函数回滚 + 激活失败（§12）

**已知坑**：

- enable 曾先落盘后激活：激活失败后盘上状态与运行期不一致
- refreshInstalled 曾无 try/catch：无桥环境 unhandled rejection
- ES module 同 specifier 只求值一次：停用再启用不重新执行入口，激活必须 `?activate=<递增序号>` 穿透缓存
- confirmInstall 激活失败必须 setEnabled(false) 保持盘上与运行期一致

---

## 分片四：electron 宿主安全

**范围**：`electron/src/`（plugins.ts、main、preload）、协议与 IPC 面

**对照条款**：contract.md §17（IPC 边界各自防线）、§18.2-§18.6（包格式 / 版本代际 / 特权协议 / 市场信任模型）

**检查项**：

- SSRF 信任边界：市场源与包地址拦截——IP 字面量直判 + DNS 全解析逐个判定（v4 网段前缀 + v6 本地/ULA/链路本地 + ::ffff: 映射提取）+ `redirect: 'manual'` 逐跳复检（每跳现查 DNS）+ 总超时；dev 覆盖模式（env 显式）边界依据 = 渲染进程不可篡改主进程 env，env 缺省必须强制公网
- 路径安全：拼路径前正则把关（id / version 字符格式防穿越）；resolve 后 `startsWith(root + path.sep)` 收口；入口路径防清单篡改越界
- 资源上限：下载体 / 解压总量 / 文件数三上限（防解压炸弹与超大包打爆主进程）；文件对话框挂父窗口
- 持久化健壮性：清单原子写（同目录 tmp + renameSync）；**物理损坏与代际纪律分流**——JSON.parse 失败走备份恢复 + 空清单继续，schemaVersion 未知拒绝读取（代际纪律），单条记录核心字段校验剔除，单代际视图构建失败降级跳过不拖垮全表
- IPC 面校验：handler 全部校验 `BrowserWindow.fromWebContents(event.sender)`；渲染侧可传参数逐个校验（URL 形状、id/version、sha256 归一后比对）
- 错误消息中文化：第三方库英文异常（fflate 解压、fetch 网络层、JSON 解析）在边界统一转中文并保留原始原因

**已知坑**：

- installFromUrl 曾无内网拦截（SSRF）
- installed.json 曾非原子写（中途崩溃留半行 JSON）
- sha256 比对曾未归一（大小写/空白差异误判校验失败）
- 协议 handler 按 pathname 解析：query 不参与路径匹配（唯一 query 穿透缓存不破坏白名单）
