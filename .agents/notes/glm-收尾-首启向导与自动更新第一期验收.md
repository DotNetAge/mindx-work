# 首启向导与自动更新第一期实施收尾（2026-10-02）

## 完成范围（第一期全部落地 + CDP 真机验收）

- **自动更新链**：electron/src/updater.ts（30s 首查 + 4h 轮询 + autoDownload + autoInstallOnAppQuit 兜底）→ preload updater 段 → UpdateBadge.vue（侧栏 Footer 纯图标：downloading 环形进度 / ready 点击确认安装）→ VersionRow.vue（四态文案 + 检查更新）→ electron-builder.yml publish 段（GitHub draft）→ pack.mjs（MX_PUBLISH=always 开关 + ad-hoc 未公证构建注入 mxAdhoc=true 禁自动更新）→ release.yml（tag 构建直传 draft）。
- **向导壳**：electron/src/wizard.ts + probe.ts。门 = 四事实派生（1314 探活 + 远程地址 + WSL 注册表 + Docker 可达性，全空才弹，无标记位天然幂等）；MX_WIZARD=1 强制；探测 IPC 通道族（mx-wizard-probe:*）随窗口装卸；closed → mx:wizard-finished 回发主窗 + showMainWindow 重建。
- **连接配置迁移**：localStorage → preferences.json 跨窗唯一事实源（plugins/src/connection/runtime.ts，向导窗写、主窗读回 + finished 重读重连）。
- **向导渲染层**：app/wizard.html 双入口 + wizard/{WizardApp,StepConnect,StepRemote,StepModels,types,daemon}；分步状态机 welcome→connect→remote→models→done；模型步凭据勾选 → 逐个主进程验证（9 供应商最小请求端点）→ takeCredential 一次性取值 → provider.list/model.list 查重 → RPC 创建（bool 全显式）。
- **重入**：设置页 WizardRow → mx:wizard-open 常驻通道。

## CDP 验收矩阵（全部真机通过）

MX_WIZARD=1 弹向导且主窗不建；welcome 文案；连接步探测报告真实渲染（1314 已检测到 / Docker 未检测到 / 禁用项「即将支持」）；mode=local 落盘（preferences.getAll 实证）；模型步 4 条凭据 + GEMINI 不支持项渲染；daemon 连接按钮可用；导入链路端到端实测（2 条查重命中标已导入、2 条 key 403 如实报「鉴权失败」不落盘——providers.yml mtime 9/12 未动佐证）；勾选计数联动；稍后再说 → 窗口关闭 → 主窗重建；mx:wizard-open 重入；重开向导 welcome 干净初始态（无勾选无徽标计数 0）；全程无运行时异常；主窗 daemon TCP ESTABLISHED（lsof 铁证）。

## 关键认知

- 「已导入」= 验证通过 + 查重命中即标成功（幂等语义），配置文件 mtime 不变不代表失败。
- 向导验证期意外触发了一次真实批量导入（脚本误点击连锁），反而完成导入链路端到端实测；干净重演证实无自动导入行为，功能无 bug。
- 本机 Anthropic/OpenRouter key 直连供应商 403（key 环境问题非 verify bug），手动 curl 交叉验证法（不回显明文只看状态码）值得复用。
- 验证实例启动必须用 Agent 工具 run_in_background（nohup/disown 都被沙箱进程组清理）；CDP 断言正则勿对 JSON.stringify 输出带空格；preferences 桥段只有 getAll/set。
- dev 下更新事件态（downloading/ready 图标）无法自然产生，留 draft release 端到端验证（二期后任意 tag 构建时顺带）。

## 收尾追加改动（同日用户反馈三件事，CDP 9/9 验证）

- **客户术语军规**：客户可见文案禁用「Daemon」，统一「智能主机」（旧「智能体主机」一并废弃）；代码层（变量/键名 mindx.daemon.*/RPC/注释）保留。已写入 AGENTS.md 军规段；向导、connection 插件（ModeRow/RemoteUrlModal）、chatflow 错误消息全部替换。
- **向导窗口去 titlebar**：`titleBarStyle: 'hidden'`（macOS 红绿灯系统层保留），页面顶部加 38px `-webkit-app-region: drag` 拖拽带。注意：CDP 截图截不到红绿灯（系统层不入 web 内容图）。
- **welcome 品牌行加 Logo**：复用 shell-chrome ChromeHeader 的 mask 手法（logo.svg mask 取形 + background-color 随 --mx-text 变色，双主题一份资源），资源复制到 app/src/wizard/assets/。

## 路径语义澄清（2026-10-02 用户定稿，第二期设计输入）

- **「本机已有智能主机」= 升级模式**：卡片文案已明示「选择此项即接入它（升级模式）：沿用其全部模型配置，不做新安装」。语义 = App 接入正在运行的已有 daemon（不管它怎么装来的），模型配置全部沿用（模型步查重兜底）。
- **Docker 路径本质 = 远程连接特例**：daemon 官方镜像 `dotnetage/mindx`（hub.docker.com），「Docker 容器」路径指「独立把 daemon 安装进 Docker」的状态，连接语义与远程主机相同（WebSocket），地址来自本机容器端口映射——不是 App 替用户管理容器生命周期。第二期做活：probe 枚举 mindx 容器拿映射端口 → 生成 `ws://localhost:<端口>/ws` 实测后落 mode=remote；无容器给 docker run 命令模板。
- **二期范围（提案待开工）**：Docker 路径三态（容器运行中直连 / Docker 可用无容器给命令模板 / Docker 不可用禁用）+ 连接插件未连接态重入入口 + draft release 更新链端到端验证。本机安装（launchd/systemd）与 WSL 代次化仍留第三期。

## 二期实施记录（2026-10-02 当日完成）

- **Docker 路径做活**：
  - probe.ts 新增 `probeMindxContainers()`（docker ps --format 全列 + Image 前缀 `dotnetage/mindx` 匹配——不用 ancestor filter，其 tag 匹配语义未实证；Ports 字段正则解析映射到容器 1314 的 hostPort + TCP 探活），ProbeReport 加 `dockerContainers: DockerContainerHit[]`。
  - StepConnect Docker 卡片转正：Docker 可用即可点（三态 tag：未检测到 Docker / Docker 可用 / 容器运行中（N））。
  - 新增 StepDocker.vue：容器运行中 → 直连候选列表（`ws://localhost:<hostPort>/ws`，落 mode=remote——连接语义与远程相同）；无容器 → docker run 命令模板（`docker run -d --name mindx -p 1314:1314 dotnetage/mindx`）+ 复制 + 「我已运行容器，重新检测」（重跑 probe，props 响应式更新）。App 不接管容器生命周期（不自动执行 docker 命令）。
  - WizardApp 步骤机加 'docker' 分支（dockerDone 落 mode=remote + remoteUrl；retryProbe 重探）。
- **connection 插件重入入口**：ModeRow 未连接/出错态渲染「打开初始化向导重新配置」行内链接 → `mx:wizard-open` 常驻通道（已连接/连接中不渲染）。
- **CDP 验证（本机无 Docker，可达断言 5/5 过）**：Docker 卡片禁用态「未检测到 Docker」、本机安装卡片仍第三期、步骤点 6 个（Docker 占位）、正常启动不弹向导（事实门工作）、连接页 ModeRow 已连接态无重入链接。**容器直连/命令模板两态无法真机验证（本机 Docker 未检测到）——留有 Docker 的环境验证**（typecheck 覆盖两侧类型同构）。
- **draft release 更新链端到端验证**：留发布时机（需打 tag 触发 CI，属发布动作非编码任务）。

## 遗留（后续期）

- daemon 版本兼容锚定检查（拉版本比对）——第三期。

## 第三期前置调研：mindx-desktop 自带 daemon 安装机制（2026-10-02，用户定稿「沿用同模式 + 做完反向对齐」）

mindx-desktop 已有成熟全套，mindx-work 直接沿用（实证文件：mindx-desktop/src/main/services/daemon.ts、scripts/build-mindx-bundle.mjs、scripts/release-all.mjs、electron-builder.yml L65-73、after-pack-prune-arch.cjs）：

1. **CI/打包注入链**：build-mindx-bundle.mjs 按 `resolveMindxVersion()`（mindx 仓库 git tag 解析，共享解析器 resolve-mindx-version.mjs）下载 `mindx-<version>-<goos>-<goarch>.tar.gz` + libonnxruntime 进 `resources/mindx/` → electron-builder `extraResources`（from resources/mindx, to mindx）→ afterPack 钩子按架构裁剪（双架构只留当前）。
2. **版本锚定纪律**：`MINDX_VERSION` 构建期经 `__MINDX_VERSION__` 注入；**禁止运行时拉 latest**（曾因 latest 导致打包 2.5.6 用户装到 2.5.3）；App 只安装与其配套测试的 daemon 版本。
3. **安装链（关键——用户指出的静默模式坑对应代码）**：放置二进制 `~/.mindx/bin/mindx` + onnxruntime `~/.mindx/lib`（免提权，Apple Silicon /usr/local 归 root 坑）+ BGE 模型 `~/.mindx/data/models/model.onnx` → 自装配用固定组合 `runInstallWithFix`：`mindx install -s`（静默跳过交互向导）失败不退出 → 转 `mindx doctor --fix` 修复/补装一次。**裸 `mindx install` 在未初始化环境会进交互向导**（App 给 90s 超时，超时置 needInit 引导终端初始化）——这就是「静默模式总漏步骤、要 doctor --fix 才能正常」的根源：`-s` 跳过的向导步骤与 doctor --fix 补装的部分存在缝隙。
4. **启动纪律（macOS）**：经 launchd `gui/<uid>/com.mindx.daemon` kickstart（不带 -k，防杀活实例丢会话）→ 未加载则 bootstrap plist；**绝不把 daemon 变成 Electron 子进程**（继承 Electron 的 TCC 身份会落「系统受控沙箱、文件无法写入」）。
5. **状态机**：boot→detecting→downloading→extracting→registering→starting→ready，另有 unsupported/needInit/needWSL 特殊态；错误展示 `~/.mindx/logs/daemon.err.log` 尾部（200 行/256KB 上限）。

第三期动工方向据此修正：向导「本机安装」步 = 复刻此链路 + 把 `install -s`→`doctor --fix` 的缝隙（漏掉的初始化步骤）在 daemon 侧修掉（治本）；CI 注入链照抄 build-mindx-bundle 模式；做完反向对齐 mindx-desktop（用户明示两者安装过程完全一致）。

- Docker 一键安装 daemon、本机安装 daemon 内置二进制——第三期（向导已留「即将支持」位）。
- WSL 代次注册表探测仅 win32 分支生效，macOS 侧恒 false——符合设计。

### CI 认知修正（2026-10-02 用户定稿：App 侧完全不碰 daemon 的 CI）

- daemon 的 CI 是 mindx 仓库自己的机制（发行命令行工具），与 App 发行是两回事；App 侧**不碰、不配置、不触发** daemon CI。
- 版本的唯一权威来源 = **mindx 仓库 git tag**（resolve-mindx-version.mjs 与运行时 MINDX_VERSION 同一解析器，天然一致）；看 tag 即知版本。
- 打包期动作 = 从 daemon 的 GitHub Release **下载产物**（`mindx-<version>-<goos>-<goarch>.tar.gz` 裸二进制归档，内嵌 runtime 资产）+ libonnxruntime（取法与 mindx Dockerfile 的 linux 取法同源——微软官方发布；arm64 用微软 osx 包，amd64 走本机 Homebrew 打包，因微软 ≥1.26 不发 x86_64）。产物经 extraResources 注入，运行时优先解压随包产物、缺失才回退在线下载。
- 细节纪律（build-mindx-bundle.mjs 实证）：下载用 curl 断点续传 + gzip -t 完整性校验；清理历史版本残留归档（防运行时误选旧版——曾出过打包 2.5.6 装到旧版的事故）。
- 注：用户口述「下载其 docker」与代码实证有出入——代码下载的是 GitHub Release 的 tar.gz 归档，非 docker pull；仅 libonnxruntime 的取法与 daemon Dockerfile 同源。以代码为准，已向用户指出。

## 第三期实施记录：本机安装路径做活（2026-10-02，全链照抄 mindx-desktop 成熟机制）

### 交付物

1. **CI/打包注入链**（electron/scripts/）：resolve-mindx-version.mjs（mindx 仓库 git tag 唯一权威，冒烟实测解析出 2.5.10）+ build-mindx-bundle.mjs（curl 断点续传 + gzip -t 校验 + 历史残留清理 + 写 version.json 版本锚）+ after-pack-prune-arch.cjs（afterPack 按架构裁剪）。electron-builder.yml extraResources `resources/mindx → mindx`；pack.mjs 打包前跑下载（MX_NO_MINDX_BUNDLE=1 可跳）；.gitignore 加 electron/resources/mindx/（660MB 绝不入库）。ORT_VERSION=1.26.0 与 mindx-desktop 一致；arm64 微软官方包 / amd64 本机 brew onnxruntime 打包（微软 ≥1.26 不发 x86_64）。
2. **主进程安装服务** electron/src/daemon-installer.ts：状态机 boot→detecting→downloading→extracting→registering→starting→ready/error/unsupported；随包产物优先解压、缺失回退在线下载（锁定版本）；runInstallWithFix（install -s 90s 超时 → 失败转 doctor --fix）；mac launchd kickstart（不带 -k）/bootstrap；IPC 常驻 mx-daemon-install:status/start/log/event；错误日志尾部 200 行/256KB；humanizeError 讲人话。版本：随包 version.json 优先，兜底字面量 2.5.10。
3. **向导安装步**：StepConnect 第 4 卡片转正（win32 仍禁用——WSL 第四期）；StepInstall.vue（阶段 spinner + 下载进度条 + 错误折叠诊断 + 复制诊断信息 + ready 落 mode=local）；WizardApp 步骤点 7 个（+安装）。

### 验证（CDP 真机 7/7 PASS）

- 安装卡片可选 → 点击进安装步 → 本机 daemon 已运行走「已运行→直接就绪」分支 → 主进程状态 ready → 继续后 mode=local 落盘进模型步 → 无运行时异常 → 日志通道结构正确
- 主窗回归：正常启动不弹向导（首启门正确）、安装 IPC 常驻可达、渲染正常、无异常
- build-mindx-bundle.mjs 真实下载验证：mindx-2.5.10 darwin 双架构归档 + onnxruntime 双架构 + version.json，gzip -t 全过
- typecheck 清零 + electron build 通过
- **诚实声明**：真实安装分支（随包解压→放置→install -s→doctor --fix→launchd）未真机跑（会动 ~/.mindx 全局状态，不宜在验证时执行）——留打包产物（dmg）安装后首启端到端验收；「已运行→就绪」分支已真机验证

### 新踩的坑

- shell `&` 起的 electron 后台进程随 shell 命令结束被回收（ECONNREFUSED）——已记 AGENTS.md（第一期记过 run_in_background，本轮再次踩，已强化）

## 本地构建模式（build-mindx-bundle.mjs --local，2026-10-02 用户提出：本地构建与 CI 完全一样的发行归档，发版前测试不必等 CI/下载）

### 设计

- `node scripts/build-mindx-bundle.mjs --local darwin-amd64`：从本地 mindx 仓库（../../mindx）直接构建，完全照抄 release.yml darwin 分支四步——①embedder 模型校验 ②go build（GOOS/GOARCH/CGO_ENABLED=1 + -trimpath + -ldflags 注入 Version/Commit/BuildTime 与 CI 同参）③brew onnxruntime dylib cp -P 入 dist + 模型复制入 dist ④tar czf 三件套（mindx + libonnxruntime.* + model.onnx）。产物已存在不覆盖。
- **模型绝不下载（用户定稿修正）**：embedder 模型本地仓库收纳、不进 git；CI 是干净 checkout 才需要从 HF 下载。本地只校验 `runtime/data/models/model.onnx` 在位，缺失报错指路。
- 下载模式照旧；--local 只影响 mindx 归档来源，Ort 独立包两架构均取本机 brew dylib（与 CI tar 内 dylib 同源）。

### 验证（真机全过）

- 归档产出 `mindx-2.5.10-darwin-amd64.tar.gz`（139214521 字节），tar tzf 布局与 CI 一致：mindx + libonnxruntime.1.26.0.dylib + .1.dylib 符号链接 + 无后缀链接 + model.onnx，符号链接链完整保留。
- 解包实测 `mindx version`：Version 2.5.10 / Commit 73b60ff / Build Time 2026-10-02T01:57:08Z（UTC ISO 与 CI date -u 同格式）/ Platform darwin/amd64——构建注入三元组全部正确。
- arm64 目标：本机 amd64 无 arm64 C 工具链（CGO_ENABLED=1 交叉编译需要），本地构建仅验证 amd64；arm64 发行归档仍走下载模式（CI 产物）。

### 新踩的坑（本地构建三连坑）

1. **gzip -t 完整性校验只适用 .tar.gz/.tgz 归档**：曾把 model.onnx 裸文件也走 download() 的 gzip 校验 → 下载 100% 成功仍被判损坏误删。后随「本地不下载模型」重构该路径消失；教训：下载校验方式必须匹配文件格式。
2. **brew dylib 是只读 444 权限，dist 残留上次产物时 cp 覆盖被拒**（Permission denied，且 stdio:ignore 吞了真实错误只见 execFileSync 堆栈）——CI 干净环境 dist 恒空无此问题。修复：写入前先 rmSync 再 cp；不整体清 dist（里面有用户手工放置的无关产物如 mindx-fix/mindx-v2，不能动）。
3. **HuggingFace 国内网络直连超时**（CI 无碍、本地必挂，5 次重试白耗 85s）——本地模式不需要下载模型，此坑已随重构规避；若未来下载模式也要在国内跑，需引入 hf-mirror.com 镜像。
4. **tar -C 只影响其后条目的查找目录**：模型不 cp 进 dist 时 tar 三件套报 `model.onnx: Cannot stat`——CI Package 步骤开头就是 cp 模型进 dist，本地实现漏抄了这步。

## 干净安装全流程真机验收（2026-10-02，用户授权卸载本机 daemon：第三期「真实安装分支」缺口补齐）

### 卸载链（按用户给定顺序，全过）

`mindx stop` → `mindx uninstall`（服务注销 + PATH 清理，~/.mindx 数据保留）→ `make uninstall`（确认 "already uninstalled"）→ `make clear`（echo yes 喂交互确认，删 dist/tmp/整个 ~/.mindx）。卸后实证：launchd `Could not find service com.mindx.daemon`、进程 0、`which mindx` not found、~/.mindx 不存在。

### 随包主路径的 dev 分支（本次代码唯一改动）

- **坑：`process.resourcesPath` 在 dev 态指向 node_modules/electron/dist/Electron.app/Contents/Resources（非空值，`??` 兜底永不生效）**——bundledMindxDir 由此读不到随包产物，dev 验证会静默滑落到在线下载分支。
- 修复：`app.isPackaged ? path.join(process.resourcesPath,'mindx') : path.join(__dirname,'..','resources','mindx')`（dev 态 __dirname=electron/dist → electron/resources/mindx，与打包 extraResources 同源目录）。打包态行为零变化。

### 安装全流程验证（真机全过）

- **四事实门（干净环境）**：electron dev 启动 → 只建向导窗「MindX Work 初始化」，主窗不建——门正确。
- **UI 流**：welcome「开始设置」→ 连接页 4 卡片（本机已有智能主机「未检测到」/ Docker「未检测到」/ 本机安装「未检测到运行中的智能主机」tagOk）→ 点本机安装卡 → 安装步自动 start。
- **安装链（主进程全程自动，约 1-2 分钟）**：释放随包归档（138MB tar 解压）→ dylib 三件套 cp -P 入 ~/.mindx/lib → 注册（runInstallWithFix：干净环境 install -s 一次成功，doctor --fix 未触发）→ launchd kickstart 拉起 → 探活 → **ready「本机智能主机已就绪」**。
- **系统级实证**：~/.mindx 完整重建（bin/data/lib/logs/agents/settings/skills/AGENTS.md/memory——**install -s 这次没漏步骤**）；`~/.mindx/bin/mindx version` = **2.5.10 / 73b60ff / 2026-10-02T01:57:08Z（正是 --local 本地构建版）**——随包解压分支确证；dylib 链接链完整；模型 94851877 字节落 ~/.mindx/data/models/；launchd state=running；1314 进程在跑。
- **交接流**：ready → 「继续」→ 模型凭据步（shell 扫描 Anthropic/通义/DeepSeek/OpenRouter 渲染）→ `mindx.daemon.mode = local` 落盘。
- **runInstallWithFix 缝隙结论**：用户报告的「静默模式总漏步骤」在本次干净环境**未复现**（install -s 一步完成全部初始化）——缝隙可能与旧版本 daemon（f07d27b）或非干净环境有关；doctor --fix 兜底链保持，daemon 侧治本修复（第四期）仍值得做但优先级可降。

### 附带发现（mindx 仓库自身，与 App 无关）

- `make uninstall` 的 PATH 清理段在 /bin/sh 下语法报错（for 循环写法 make 兼容问题），CLI `mindx uninstall` 的 PATH 清理可用但 .zshrc 残留一行 `# mindx CLI` 注释（grep -v '^# MindX$' 大小写不匹配）——若反向对齐 mindx-desktop 或动 mindx 仓库时顺手修。
