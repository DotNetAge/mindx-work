# mindx-work 工作规则

## 客户术语军规（2026-10-02 用户定稿）

- **客户可见文案禁用「Daemon」**：daemon 是团队内部叫法，一切对客户呈现的文本（UI 界面、错误消息、对话框、向导、日志的用户可读部分）一律统一用「**智能主机**」；旧文案「智能体主机」也一并废弃统一。代码层不受限：变量名、preferences 键（`mindx.daemon.*`）、RPC 方法名、类名、代码注释里的 daemon 保留原名。改文案时全局自查：`grep -rn "daemon" --include="*.vue" | grep -v "^\s*//" | grep -E "：|。|（"` 逐条人审（模板文本 vs 代码标识符）。
- **客户可见文案禁暴露技术细节（2026-10-02 用户红笔标注）**：安装路径（`~/.mindx`）、服务名（launchd/systemd/com.mindx.*）、命令行、目录结构等实现细节一律不进 UI 文案与错误消息——客户只需要知道「做什么、结果如何、下一步怎么办」，路径只在诊断详情（原始错误 detail）里保留。写完文案自查：`grep -rn '~\.\|/usr/\|launchd\|systemd\|\.mindx' --include='*.vue' app/src ui-shell/src` 与主进程 humanizeError 类「讲人话」消息函数逐条过。

## daemon RPC 调用（Go 结构体参数）

- **bool 字段必须显式传值，绝不依赖缺省**：daemon 侧 Go 结构体（如 `goharnessconfig.ModelConfig`）的 bool 字段是普通 `bool` 而非 `*bool`，JSON payload 缺字段 → 反序列化零值 `false` → 落盘即「停用/关闭」。实例：`addOnlineModel` 漏传 `enabled` 导致在线添加的模型全部落盘 `enabled: false`（2026-09-28 修复）。新增 RPC 调用时逐一核对 Go 侧结构体字段，bool 一律显式传。
- **RPC 返回字段名以 daemon 实测响应为准，禁止凭移植来源的类型声明推断**：`buildMonthlyStats` 的 `daily_usage`/`model_breakdown` 条目字段是 `input_tokens`/`output_tokens`，而移植自 mindx-desktop 的 UsageView.vue 按 desktop 类型写成了 `prompt_tokens`/`completion_tokens` → 模板里 `formatCount(undefined)` 渲染崩溃。对字段先发真实 RPC 探针（ws://localhost:1314/ws 直连发 JSON-RPC）核对响应 JSON，再写 interface。

## 验证与实效

- **样式/布局改动必须验证编译产物**：scoped CSS 中 `:global(祖先) .后代` 组合会被编译器丢弃后代选择器（产物退化为只作用于祖先元素），需整体包进 `:global()`；改完 curl dev server 的 style 子模块核对产物，不猜。
- **CSS 变量禁止自造，必须对照 `.agents/skills/mx-uikit/SKILL.md` 的 token 表**：体系里没有 `--mx-bg-primary`、`--mx-text-primary`、`--mx-border`、`--mx-bg-hover`（正确的是 `--mx-bg-window/surface/elevated`、`--mx-text`、`--mx-border-strong`/`--mx-separator`、`--mx-hover`）。自造变量 `var()` 解析为空 → 背景透明裸奔（实例：组队对话框用错变量三次返工，2026-09-28）。写样式前查表；自查命令：`grep -rhoE 'var\(--mx-[a-z0-9-]+' <files> | sort -u` 与定义全集求差集。curl 核对编译产物只能证明规则存在，不能证明变量有效。
- **Teleport 到 body 的弹层不受组件根作用域约束**，样式类要完整自包含；验证弹层视觉用带 CDP 的 Electron 副本（`electron . --remote-debugging-port=9333` + Playwright `connect_over_cdp`）真实点开看截图，不要用 headless 直连 vite（bridge 缺失点击全失效）。
- **验证数据态 UI 用 Pinia 直注而非 localStorage 注入**：localStorage 注入后 reload 会被 daemon 恢复链清空（连接后自动恢复上次会话，`setPendingFilesFromServer` 以服务器为准整体替换）。正确路径：CDP 页面里 `document.querySelector('#app').__vue_app__._context.provides` 遍历 **`Object.getOwnPropertySymbols`**（pinia 的 provide 键是 symbol，getOwnPropertyNames 拿不到），取含 `_s Map` 且有 `chatflow-store` 的值，直接改 store 内存态，响应式 UI 即时生效。
- **Vue setup 的 `{ immediate: true }` watch 回调同步执行**：回调内引用声明在后的 ref/ref 会 TDZ 报错（`Cannot access 'x' before initialization`），且错误发生在组件挂载期表现为 DetailPane 等宿主容器白屏 + `Cannot set properties of null (setting '__vnode')`——见此报错先查 immediate 回调的声明顺序，不要往 HMR 方向猜。
- **「界面永久卡在加载态」先怀疑渲染函数崩溃，不要查 RPC**：渲染期抛错（如 `formatCount(undefined)` 读 `toLocaleString`）会让 Vue 更新中止，DOM 冻结在崩溃前的最后一帧，之后每次更新都重复崩溃且无弹窗——表现与「接口挂死」一模一样。鉴别法：CDP 读 `el.__vueParentComponent.setupState`，状态已更新而 DOM 未变即坐实；pageerror 监听可拿到真实报错。
- **Electron 全屏浮层与拖拽带冲突**：`position: fixed; inset: 0` 的浮层会撞 macOS 顶部 48px 拖拽带（红绿灯区），头部件全部失去点击；插件内优先用 Content 席位而非全屏浮层（用户明确偏好 Content）。

## Electron 终端与壳布局（2026-09-28）

- **文件路径转自定义协议 URL 必须 `path.split('/').map(encodeURIComponent).join('/')`**：`encodeURI` 不编码 `#`/`?`/`%`（视作 URL 结构字符），含 `#` 文件名的 mx-file:// 路径会被截成 fragment；逐段 encodeURIComponent 才完整还原。
- **pty 必须用 @lydell/node-pty，禁用原版 node-pty**：原版 1.1.0 在本机 macOS 上 `posix_spawnp failed` 全矩阵失败（electron 主进程 / ELECTRON_RUN_AS_NODE / 系统 node 三种环境一致复现，与 env/cwd/绝对路径无关），加载成功但 spawn 必挂。@lydell/node-pty（活跃维护 fork，带 prebuild）spawn 正常。降级路径 `/usr/bin/script -q /dev/null zsh -l` 在新版 macOS 同样不可用（要求 stdin 是 tty，管道 stdin 直接报 tcgetattr 错退出）。
- **壳布局是三列制，Toolbar 只属 Content**：AppFrame 为单行三列——Sidebar 全高在左（darwin 交通灯悬浮其顶部 topBand）｜中列 = Toolbar + Content｜Detail 轨道全高独立成列（其 48px 头部行与 Toolbar 同一水平线）。ToolbarPane 禁止横跨全窗（2026-09-28 曾做成通栏顶条被用户否决："Sidebar 上方就是系统三按钮，Toolbar 只能在 Content 顶部"）。
- **xterm 主题色经 probe 元素解析**：xterm 不认 `var()`/`color-mix()`，CSS 变量需先塞进临时 span 的 color 再取 computedStyle 得 rgb()/rgba() 串；等宽字体同样取 `--mx-font-mono` 的 computed 值。
- **Detail 内禁止 Tab 组件**：轨道头部行是 DetailToolbar 区（左激活条目 Title + 右尾段按钮组席位），条目激活只走编程式 `show / setActiveTab` 隐式切换；用户不手动切 tab（2026-09-28 契约定稿，见 docs/组件层契约.md §4/§8——曾做成一排 tab 按钮被用户否决"这堆东西不要"）。**按钮组按条目私有**（`addToolbar` 带 `owner` 归属，激活谁显示谁的，非全轨道共用；条目 remove 时级联移除）。各插件内部页签（如 web-viewer 浏览器页签）自管。
- **层模型（激活链）定稿**：激活主体是"同 owner 条目组 = 插件的层"，激活沿 Sidebar→Content→Detail 单向传播、用户不手动切层（iOS Stack View 心智，2026-09-28 用户定稿，契约 §8.4）。Toolbar/Detail 条目 `owner` 指向 Content 条目 id：Toolbar = 全局层（owner 省略恒显，如文件夹/浏览器/终端图标）+ 激活层叠放；Detail **展开才联动**（轨道收起时不自动弹），激活者无 Detail 层则保持原内容（缺区回退）；owner 省略的 Detail 条目 = 独立唤起层。装配接线在 createApp（Content.onActivate → Detail.setActiveTab），启动期校验 owner 存在。

## 图标与工具回显（2026-09-29）

- **lucide 本地集合没有 floppy-disk**：`@iconify-json/lucide`（1.2.136）里软盘图标实名是 `save`（图形即 3.5 寸软盘），`floppy-disk`/`floppy` 键不存在。MxIcon 用不存在的图标名**静默渲染空白**（无警告无占位）。新增图标名前先查键：`node -e "…require('…/icons.json').icons['名字']"`。
- **MxIcon size 枚举只有 16|20**（连续两个会话踩到）：`<MxIcon :size="14">` 报 TS2322 `Type '14' is not assignable to type '16 | 20 | undefined'`。写 MxIcon 时 size 只用 16 或 20，不要凭感觉传其它值。
- **pnpm 严格模式下 CodeMirror 子包必须显式安装**：meta 包 `codemirror` 不 re-export `@codemirror/view`/`@codemirror/state`/`@codemirror/commands`/`@codemirror/language`/`@codemirror/autocomplete` 的 API，直接 import 即幻影依赖（element-plus 幻影依赖先例同型）。2026-09-29 集成 CodeMirror 6 时预防性显式安装全部子包到 ui-shell-vue。
- **工具回显可能被污染，落盘证据只认 git diff**：Edit/TodoWrite/Shell 回显出现过与输入不一致的文本变体（路径、行号、注释被改写），但磁盘实际改动精确无误。回显可疑时用 `git diff <file>` 复核真实落盘状态，不要凭回显判断成败，更不要因怀疑回显而重写文件。

## CDP 验证脚本纪律（2026-09-29）

- **多个 CDP 验证脚本进程并发持同一页面连接会交错执行**：后启动脚本的截图会读到前一脚本设置的 DOM 中间态（实例：三个补拍脚本并发时截图主题 light/dark 反复跳变，四点采样探针在 pkill 全部残留 node 进程后立即稳定）。每轮验证前先 `ps aux | grep cdp_` 清残留；脚本必须 `process.exit(0)` 收尾，补拍前确认上一进程已死。
- **Page.captureScreenshot 在窗口不可见时挂起超时**：electron 窗口最小化/被完全遮挡时 evaluate 一切正常、仅 captureScreenshot 永久超时。截图连续超时先确认窗口可见，不要反复重跑脚本或往页面状态方向猜。
- **Pinia store Proxy 经 CDP returnByValue 序列化不稳定（2026-09-29）**：`Runtime.evaluate` 返回 `{ ex: pinia._s.get('xxx') }` 这类含 store Proxy 的对象，字段回读全为 undefined——但操作已真实生效（后续诊断探针可见状态已变更），仅序列化丢数据。探针必须在表达式内先提取基本类型字段（`String(ex.rootDir)` 等）组成 plain object 再返回，禁止直接返回 store 引用。
- **vite dev server 绑定 IPv6 `[::1]`，curl 127.0.0.1 必然连接失败（2026-09-29）**：`curl http://127.0.0.1:5273/` 返回 000 会误判 dev server 已死，实际 `http://localhost:5273/`（解析到 ::1）返回 200。探活一律用 localhost；`lsof -nP -iTCP:5273 -sTCP:LISTEN` 看真实绑定。electron 加载的正是 localhost URL，vite 起来后页面 reload（`Page.reload`）即可恢复，不必重启 electron。
- **验证主进程行为（pty 等）前必须核对 electron dist 新鲜度（2026-09-29）**：`electron/src/*.ts` mtime 晚于 `electron/dist/*.js`（`pnpm --filter @mindx-work/electron build` 产物），且长跑 electron 实例加载的是启动时刻的 dist——源码、产物、运行实例三层都可能不同步。实例：dist 落后源码 25 分钟、实例落后 dist 2.5 小时，终端 pty 行为误判排查绕远。改主进程源码后：build → 杀实例重启 → 再验证。
- **zsh + powerlevel10k 环境 pty 启动需 2-10 秒**：spawn 后 prompt 输出明显滞后（首个采样 2 秒 960 字符、4 秒 4009 字符、完整 prompt 可到 10 秒），短等待窗口会把「启动中」误判为「shell 不存活」（实例：3 秒采样零输出误诊 shell 死亡，延长到 10 秒一切正常）。对 pty 输出做断言前用长度轮询等到输出稳定，不要固定短 sleep 后下结论。

## 首启向导与 CDP 断言细节（2026-10-02）

- **Shell 会话内 `&`/nohup/disown 启动的 electron 会随命令结束被杀**（连杀 3 次排查半小时）：Agent 工具的 shell 沙箱在命令返回后清理整个进程组，nohup+disown 也拦不住 SIGTERM。常驻验证实例必须用工具的 `run_in_background` 参数启动。【2026-10-02 二期验证再次连踩 2 次——写完命令顺手 `&` 是肌肉记忆，凡是启动 electron 实例的命令，先想 run_in_background 再动手】
- **CDP 断言别对 `JSON.stringify` 输出做带空格正则**：`JSON.stringify({hasBridge:true})` 输出 `"hasBridge":true`（无空格），断言 `/hasBridge": true/`（带空格）永远 FAIL——桥明明在却误判缺失，白白排查一轮。
- **contextBridge 的 preferences 段只有 `getAll`/`set`，没有 `get`**：验证落盘用 `window.mxDesktop.preferences.getAll()`，写 `preferences.get(key)` 直接 TypeError。
- **CDP 模拟点击必须锁定真实 button，勿用 `querySelectorAll('button, div, label')` 混合选择器**：find 取文档序首个 innerText 匹配会命中卡片祖先容器或错误元素，click 在祖先上派发到不了后代的事件处理器；更危险的是可能命中意外目标触发连锁动作（实例：验证脚本一次误点击意外触发了整批模型导入——行为本身符合设计，但触发源排查耗了数轮）。
- **Vue 受控 checkbox 在 `click()` 后同步读 `.checked` 是 patch 前旧值**：change → toggle → ref 更新 → DOM 回写走微任务，同步读数是假象；断言勾选态要 sleep 后重读或读按钮计数文案。
- **向导「已导入」语义 = 验证通过 + 查重命中**：provider/model 已存在时跳过创建同样标记 imported（幂等语义），providers.yml/models.yml mtime 不变不代表导入失败；验证失败（401/403）则不落盘不回显 key。
- **key 直连供应商 403 不一定是 verify 实现错**：先拿 shell 里的 key 手动 curl 供应商端点（不回显明文，只看状态码）交叉验证——本机 Anthropic/OpenRouter key 直连即 403（key 本身当前网络环境不可用），verify 判定正确。
