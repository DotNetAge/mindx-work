# 首启初始化向导与打包发行（设计讨论定稿）

日期：2026-10-02　状态：方向定稿，未实施

## 用户拍板的三个决策

1. **向导形态 = 独立全屏向导窗口**（否决了主界面内嵌引导方案）。仪式感、与主界面隔离；代价是需单独窗口壳 + 状态桥接 + 重入入口设计。
2. **凭据导入 = 勾选 + 逐个验证后导入**。不静默导入，用户对写入配置的内容知情；验证失败的项当场提示不落盘。
3. **本机 daemon 二进制 = 随包内置**（extraResources）。离线可用、无下载失败链路；代价是安装包体积增大。

## 核心设计共识

- 向导本质是「连接仲裁」：daemon 是外部资源，向导回答四件事——daemon 在哪/怎么获得/怎么连上/模型配了吗。探测驱动而非选择题驱动：首启静默探测（1314 探活、~/.mindx、docker info、wsl -l -v、凭据扫描）→ 建议路径 → 用户确认/改选 → 执行 → 模型配置 → 完成。
- 跳过是一等公民：每步可「稍后再说」，跳过后进主界面（NoModel/未连接引导态已有现成形态），向导可重入。
- daemon 四路径：远程直连（runtime.ts 双模式已支持，认证可参考 phone-pair 配对码）/ 本机已有 daemon（探活命中直接连 + 拉其 models 复用）/ 本机 Docker / 本机安装（mac/Linux 内置二进制 + launchd/systemd；Windows 走 WSL）。

## WSL 代次化方案（根治 mindx-desktop 同名冲突）

- 病根实证：mindx-desktop/src/main/services/daemon.ts importMindxWsl 固定名 + 导入前无条件 `--unregister` + `rm -rf` 安装目录；损坏时 nextFreeDistroName 找 MindX-2/3 兜底，残骸只进不出。
- **EBUSY 实证（用户 Windows 真机诊断，2026-10-02）**：`EBUSY: resource busy or locked, unlink 'C:\Users\Administrator\.mindx\data\studio\wsl\ext4.vhdx'`。根因链三条实锤：①runWindows 里 importMindxWsl（L673）在 stopWslProc（L681）之前执行，且全文件无 `wsl --terminate`/`--shutdown`——上一轮拉起的发行版保持 Running，ext4.vhdx 被 wslservice/vmcompute 锁定；②importMindxWsl 首行 `fsp.rm(installDir, { recursive, force })` 无 maxRetries（Node 的 rm 对 EBUSY/EPERM 仅在 maxRetries>0 时重试，缺省 0 次直接抛）→ unlink 立即炸；③结构性缺陷：fallback 换名（MindX-2）但**共用同一个 installDir**（`studio/wsl`），rm 共享目录必须删掉旧发行版的 vhdx 才能得到「目标目录不存在」——旧发行版 Running 时结构性必炸。验证法：出错时 `wsl -l -v` 看 MindX 是否 Running。
- 方案：发行版名 `MindX-<代次号>`（注册表递增，不用版本号）；注册表 `~/.mindx/data/studio/wsl/registry.json`（当前代次名/版本/目录 `studio/wsl/gen-N`）；升级 = 新代次导入 → 数据迁移 → 探活 → 注销旧代次，失败回退旧代次；残骸收割只动 `MindX-*` 前缀且不在注册表中的，绝不碰用户自建发行版。
- 必须继承的实证经验：WSL_UTF8=1 + UTF-16LE 解码、`--version 2` 显式导入（防 WSL1 静默降级）、`--import` 目标目录必须不存在（清残留再建父级）、localhost 转发失败降级 WSL IP 直连。
- 由 EBUSY 实证新增的三条硬约束（新向导 WSL 流程）：①删除永不进关键路径——每代独立目录 gen-N，导入前零删除，旧目录只在成功后后台收割（先 terminate 再删），失败只记日志下轮再收；②动任何 vhdx 前必须 `wsl --terminate <发行版>` 并轮询 `wsl -l -v` 确认 Stopped；③所有 `fsp.rm` 必须带 `maxRetries`/`retryDelay`（EBUSY/EPERM/ENOTEMPTY 内建重试）；兜底逃生门：仍锁定（杀毒/备份软件常见锁源）时提示「重启电脑后重试」并附 vhdx 路径与 wsl -l -v 输出。
- WSL 与 Docker 并存：虚拟化层不冲突，冲突点是 1314 端口归属；不做自动裁决，向导亮探测现状由用户选，默认建议按探测结果排。

## 凭据发现（三层优先级）

1. 已有 daemon 的 models 配置（RPC 直接拉，"复用"优先于"发现"）；
2. shell rc 只读解析（~/.zshrc/~/.bashrc/~/.profile）；Windows 读进程 env 即可靠（GUI 启动继承用户注册表环境变量）；
3. App 进程 env（兜底）。
- **关键坑**：macOS/Linux Finder/Dock 双击启动的进程 env 是 launchd 给的，不含用户 shell 的 env——只读进程 env 会漏掉绝大多数手工配置，必须读 rc 文件。

## 分期

①探测+连接向导（远程/已有 daemon，纯前端+少量主进程 IPC）→ ②模型导入/配置步 → ③本机 daemon 安装（mac/Linux）→ ④Windows WSL 代次化（需真机验证）。

## 更新机制定稿（2026-10-02 用户拍板）

三个决策：**electron-updater 全自动** + **daemon 独立版本+兼容检查**（否决同版同步） + **GitHub Releases 更新源**（否决自托管静态源/双源）。

1. **App 更新链**：electron-builder.yml 配 `publish: { provider: github }`，electron/ 子包加 electron-updater 依赖；release.yml 的 tag 构建从 `--publish never` 改为直传 GitHub Release（建议 draft 起步人工确认发布）。产物要求：mac 带 zip 目标（electron-updater 只认 zip 更新）、win 必须 NSIS、blockmap 差分下载自动生成。**完整链路 = 运行中自动发现（启动延迟检查约 30s + 定时轮询约 4h）→ 后台自动下载（download-progress）→ 下载完成主动提示安装（用户定稿：纯图标态变化 + 轻提示「新版已就绪」，点击确认 `quitAndInstall()` 立即重启安装；不打断当前工作）→ `autoInstallOnAppQuit` 退出时自动安装兜底（用户未响应提示时也会装上）**。UI：发现更新即侧栏/托盘纯图标出现（下载箭头），仅在有更新时出现；下载中图标可呈进度态；设置页「关于」行 = 当前版本 + 手动检查入口。
2. **公证硬依赖**：mac 自动更新要求签名公证全绿——CI secrets 缺失降级 ad-hoc 的构建必须禁用自动更新（Gatekeeper 会拦未公证的更新版本）。
3. **daemon 版本锚定原则**（注入链执行细节留第三期）：打包配置显式写 daemon 锚定版本号，CI 按锚定版本下载 mindx-daemon release 产物注入 extraResources；App 发版不被迫等 daemon 最新版。
4. **兼容检查模型**：App 内置「最低 daemon 版本」常量，连接后 RPC 拉版本比对，**只设下限不设上限**（daemon 向后兼容 RPC 是 daemon 的义务）。三态：①达标正常；②本机 daemon（App 升级后包内自带新版）→ 自动升级本机拷贝并重启服务；③外部 daemon（远程/容器/WSL）→ 连接区兼容性警告 + 按路径给指引（远程→升级远端；容器→拉新镜像；WSL→触发代次升级）。

## 待细化

独立向导窗口的窗口壳与状态桥接（主进程探测/安装 IPC 通道、向导完成后交接主窗口避免双窗同显）、重入入口（设置页「重新运行向导」+ 连接插件未连接态引导按钮）。

## deepseek-harness welcome 机制借鉴（2026-10-02 调研）

证据：apps/desktop/src/welcome-api.ts（IPC 契约 + needsWelcome 门）、apps/desktop/src/welcome-backend.ts（凭据状态探测与写回）、packages/client/ui-settings-models/src/DeepSeekOnboardingDialog.tsx（设置页 readiness 重入对话框）。

1. **needsWelcome 门 = 纯函数派生判定**（welcome-api.ts:58-59）：`!loggedIn && !hasApiKey` 才弹 welcome，两个认证路由任一配置过即跳过；**完成与否不存标记位，而是环境事实的派生**——skip()「不写 onboarding-completion setting」，下次启动重新按事实判定，天然幂等可重入可测试。启示：我们的门 = 「1314 探活失败 + 无远程地址 + 无 WSL 代次 + 无 Docker 容器」的探测事实派生，不写「已看过向导」标记。
2. **凭据引用 + 状态位，向导永不摸 key 明文**（welcome-backend.ts:64-114）：provider 在 settings 声明 `apiKeyEnv` 凭据引用 → llm.listConfigurableProviders 枚举 provider 的 settingsNs/settingsPath 地址 → 逐个解析出引用 → credentials.describe 批量查状态（64 个/批，只返回 configured/writable 布尔）→ welcome 渲染层拿到的只有 WelcomeState 四个事实（loggedIn/hasApiKey/writable/localePreference）；写回走 credentials.set，失败返回 `{ok:false}` 且**诊断文本不透传**（"Provider diagnostics may contain credentials"）。启示：我们「勾选+验证后导入」的实现形态 = 主进程持有引用解析与验证，渲染层只见状态位；验证失败提示不回显 key。
3. **向导 IPC 按需安装**（welcome-api.ts:7-14）：WELCOME_IPC 通道族「installed only while its window exists」——向导窗销毁即卸载，不污染主窗口 IPC 面。
4. **印证既有决策**：welcome 渲染层无任何系统动作，探测/读取/写回全在主进程（connectDesktopWelcome 走 Web RPC），与我们定的「系统动作全在主进程 IPC、向导渲染层只做视图」同构。
5. **差异边界**：DeepSeek 的 welcome 只管认证（账号登录 / API Key 双路由），不管 daemon 基础设施——它的 host 就是本地 Web 应用。我们比它多一层「daemon 在哪」的连接仲裁，这部分仍按已定四路径方案执行；可借鉴的是门判定、凭据状态位、skip 语义三件。
