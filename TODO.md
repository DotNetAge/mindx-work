
# TODO

- 插件发布通道（2026-10-02 用户定稿「本轮做导出，发布后议」）：设计 mindx-market 内容仓库的收录/提交机制 + 壳侧发布入口（导出 zip 已实施：设置 → 插件 → 已安装行导出按钮；市场索引当前为静态托管 index.json，发布 = 条目入仓 + 版本 zip 托管 + sha256 登记）
- mw CLI → app 即时激活链路端到端验收（2026-10-02，install-cli 已落 ~/.mindx/bin 并实测 CLI 侧通过）：起 dev 实例 + `mw plugin install` 真装一个插件，验证 watch 广播 → plugins:changed → 渲染侧差分激活在真实 app 中生效（UI 可见新插件出现，无需重启）

动态看板 - 这是一种技能，一种写Widget的方式将数据嵌入至看板之中。看板是一种数据结构，里面就是一堆的 Widget, 那么Agent可以将数据放在目录，定义不同的看板文件，看板插件就可以选择不同的看板文件(*.kanban)由Agent通过数据的方式定制界面，Agent方则只要面向看板文件，进入目录就可以自动将目录中 .agents/kanbans/ 目录下的所有文件看板加载进来动态地为用户配置界面。
    - BUG 管理看板
    - 项目管理看板 - 甘特图
    - 传统看板
    - 人力资源看板
    - 需求管理看板
  Widget 就是一个Vue组件，可以定义位置，宽度，高度，Header，Footer，Content 等部分，看板文件就是个JSON, 看板是由Layout组成（基于 24栏）理论进行自动渲染.Widget要有一个顶部元素，和一个加载后自动载入的Script，如果存在 `startScript`。

- [ ] ABC

## 首启初始化向导与打包发行（2026-10-02 讨论定稿，待分期实施）

- 已定决策：①向导形态 = 独立全屏向导窗口（非主界面内嵌）；②凭据导入 = 勾选 + 逐个验证后导入（不静默导入）；③本机 daemon 二进制 = 随包内置（extraResources，不在线下载）
- 四条 daemon 获取路径：远程直连 / 本机已有 daemon（1314 探活）/ 本机 Docker / 本机安装（mac/Linux 内置二进制 + launchd/systemd；Windows = WSL 代次化导入）
- WSL 方案（根治 mindx-desktop 同名冲突）：发行版名 `MindX-<代次号>` + 注册表 `~/.mindx/data/studio/wsl/registry.json`，每代独立目录，升级 = 新代次导入→数据迁移→探活→注销旧代次，失败回退；残骸收割只动 MindX-* 前缀；继承 mindx-desktop 经验（WSL_UTF8/UTF-16LE 解码、--version 2 显式导入、--import 目标目录必须不存在、localhost 转发失败降级 WSL IP 直连）。EBUSY 实证（Windows 真机：unlink ext4.vhdx 被锁）→ 三条硬约束：删除永不进关键路径（每代独立目录导入前零删除）、动 vhdx 前必须 terminate + 轮询 Stopped、fsp.rm 必带 maxRetries；锁定兜底提示重启后重试
- WSL 与 Docker 并存：不做自动裁决，向导亮出探测现状由用户选，默认建议按探测结果排
- 凭据发现三层优先级：已有 daemon models 配置 > shell rc/Windows 用户 env 只读解析 > App 进程 env（macOS Finder/Dock 双击启动拿不到 shell env，是关键坑）
- 分期：①探测+连接向导（远程/已有 daemon）→ ②模型导入/配置步 → ③本机 daemon 安装（mac/Linux）→ ④Windows WSL 代次化（真机验证）
- **第一期已实施并 CDP 真机验收通过（2026-10-02，含并入第一期的自动更新机制）**：更新链（updater.ts + UpdateBadge + VersionRow + publish 配置 + mxAdhoc 降级 + release.yml 直传 draft）、探测 IPC、向导壳（四事实门 + 完成交接主窗）、连接配置迁移 preferences.json、向导渲染层分步状态机、模型导入步（勾选→验证→导入）。验收矩阵与关键认知见 `.agents/notes/glm-收尾-首启向导与自动更新第一期验收.md`；dev 下更新事件态（downloading/ready 徽章）留 draft release 端到端验证
- 待细化：~~独立向导窗口的窗口壳与状态桥接~~（第一期已完成）；~~重入入口之「连接插件未连接态」入口未做~~（第二期已完成：ModeRow 未连接/出错态行内链接 → mx:wizard-open）
- **第二期已实施（2026-10-02 当日，Docker 路径语义 = 远程连接特例，官方镜像 dotnetage/mindx）**：probe 容器枚举（docker ps 全列 + Image 前缀匹配 + 端口映射解析 + 探活）、StepConnect Docker 卡片三态转正、StepDocker 引导步（容器运行中直连落 mode=remote / 无容器给 docker run 命令模板 + 复制 + 重探；App 不接管容器生命周期）、WizardApp docker 分支接线、ModeRow 向导重入入口。CDP 可达断言 5/5 过；**容器直连/命令模板两态本机无 Docker 无法真机验证——留有 Docker 的环境验证**；draft release 更新链端到端验证留发布时机（打 tag 触发 CI）。见 notes「二期实施记录」段
- 设计缺口盘点（2026-10-02 自评，动工对应期前必须补）：①daemon 二进制注入链 = 第三期硬前置——mindx-daemon 是独立 Go 仓库，交叉编译产物如何进入 mindx-work 打包（CI 跨仓库机制/pack.mjs 尚无 daemon 资源注入）未设计；锚定原则已定 = 打包配置显式版本号 + CI 按版本下载 release 产物；②服务注册与 daemon 生命周期细节（launchd plist/systemd unit、崩溃重启策略、日志位置）未设计；版本兼容 RPC 模型已定 = App 只设最低版本下限，三态处理（正常/本机自动升级/外部警告+指引）；③~~发行与更新机制~~已实施完成——余 draft release 端到端验证留发布时机；④Windows 真机验证环境与 rootfs tar 维护机制未落实。第一期（探测+连接向导+模型步）设计已齐，可开工
- **第三期已实施（2026-10-02 当日，全链照抄 mindx-desktop 成熟机制——用户定稿：App 侧不碰 daemon CI，版本唯一权威 = mindx 仓库 git tag）**：注入链（resolve-mindx-version + build-mindx-bundle + afterPack 架构裁剪 + extraResources，实测下载 mindx 2.5.10 双架构归档 + onnxruntime 1.26.0，gzip 校验全过）、主进程安装服务 daemon-installer.ts（状态机 + runInstallWithFix 静默安装自愈 + launchd kickstart + IPC 常驻 + 错误日志尾部）、向导本机安装步转正（win32 仍留第四期）。CDP 真机 7/7 PASS（「已运行→直接就绪」分支）+ 主窗回归 + 产物完整性验证；**真实安装分支（解压→放置→install -s→launchd）留 dmg 打包产物安装后首启端到端验收**。见 notes「第三期实施记录」段
- **本地构建模式已实施（2026-10-02）**：build-mindx-bundle.mjs `--local`——从本地 mindx 仓库照抄 release.yml darwin 四步链（模型校验不下载/CI 同参 go build/brew dylib cp -P+模型入 dist/tar 三件套），本地产出与 CI 完全一样的发行归档供发版前测试。真机验证：amd64 归档布局与 CI 一致、`mindx version` 三元组（2.5.10/73b60ff/UTC）正确。arm64 本机无 C 工具链仍走下载模式（CI 产物）。详见 notes「本地构建模式」段
- **干净安装全流程真机验收通过（2026-10-02，用户授权卸载本机 daemon）**：卸载链（stop/uninstall/make uninstall/make clear）→ 干净环境四事实门弹向导 → 本机安装卡 → 真实安装分支全程自动至 ready（随包解压 = --local 本地构建版 73b60ff 实证、runInstallWithFix 一次成功、launchd running、1314 探活）→ 继续落 mode=local 进模型步。**「静默安装漏步骤」未复现（install -s 一步完成），daemon 侧治本优先级可降**；dev 随包路径分支修复（app.isPackaged 判断）。详见 notes「干净安装全流程真机验收」段
- 第四期遗留：Windows WSL 代次化导入（真机验证）；dmg 打包态（isPackaged 分支）安装→首启端到端验收（dev 态已验，打包态主进程 resourcesPath 路径行为未真机验）；draft release 更新链端到端（发布时机）；mindx 仓库顺手项——make uninstall PATH 清理段 /bin/sh 语法错 + .zshrc 注释残留
