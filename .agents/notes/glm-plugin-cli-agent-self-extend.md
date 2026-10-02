# mw CLI — Agent 插件安装回路（2026-10-02）

分类：功能/插件体系+CLI ｜ 状态：已完成（typecheck + electron/app build 通过；CLI 全链路临时根实测通过）

## 任务与用户决策

用户想法：插件能力经 CLI 传导给终端 Agent →「Agent 自己扩展自己」。调研证实此前无任何 CLI 入口。用户决策（AskUserQuestion 两问）：①形态 = Electron 二进制子命令（ELECTRON_RUN_AS_NODE=1，node-pty 同机制，与 UI 同源同版本无漂移）；②生效 = app watch installed.json 即时激活（非重启生效）。

## 架构定稿

- **三层拆分**：`electron/src/plugin-store.ts`（纯 Node 工厂 `createPluginStore(rootDir)`：清单读写/zip 安装/SSRF 防线/导出，零 electron 依赖——**ELECTRON_RUN_AS_NODE 下 electron API 不可用**，这是拆分的根因）+ `electron/src/plugins.ts`（electron 薄层：mx-plugin 协议/IPC/dialog/watch 广播）+ `electron/src/cli.ts`（CLI 路由）。
- 子命令：`mw plugin list/install/uninstall/enable/disable/use/export` + `mw install-cli`；`--json` 机器回执 `{ ok, data|error }`（Agent 是第一消费者）。存储根 = 平台 userData 约定推导（productName「MindX Work」，mac `~/Library/Application Support/MindX Work`），`MW_PLUGIN_ROOT` env 覆盖。
- **即时生效链**：CLI 原子写 installed.json → 主进程 watch **安装根目录**（watch 文件在 rename 原子替换后句柄失效——必须 watch 目录过滤文件名）防抖 300ms → `plugins:changed` 广播 → market store `refreshInstalled` 差分激活（新装+启用→activate；停用→deactivate；切版→先停再激活；卸载→兜底停活；**首刷只建快照不激活**——防把启动期已激活插件误判为 CLI 新装重复 activate）。diff 用值比较（快照对象逐帧重建，引用比较恒异）。
- `mw install-cli`：wrapper 写 `~/.mindx/bin/mw`（**mindx 同款目录，禁写 /usr/local/bin——系统路径有权限绞杀**），内容写死 execPath + `__filename`（app 安装路径固定）；安装后检查 4 个 shell rc（.zshrc/.bashrc/.bash_profile/.profile）的 `.mindx/bin` PATH 导入行，全无才补写 .zshrc（`# MindX Work` + export 行），避免重复导入。
- 技能传导：contract.md §18.7 记录回路；Agent 工作流 = 写包 → `mw plugin install ./dist/x.zip` → `mw plugin list --json` 验收。

## 实测证据

临时根（MW_PLUGIN_ROOT=mktemp）全链路：install test.demo@1.0.0 → list 显示已启用 → disable → export zip（389B 产物）→ uninstall → 空态。`--json` 两态（空/有数据）均正常。

## 实踩坑（已录 AGENTS.md）

1. **tsc 失败仍 emit 半产物**：noEmitOnError 默认 false，build 报错后直接跑 dist 撞诡异报错（cli.js 半产物被 ESM loader 拒，误判模块格式问题；实际是 import.meta TS1343）。先看 exit code 再测产物。
2. cjs 输出下 `import.meta.url` 不可用（TS1343），取自身路径用 `__filename`。
3. 重写 IPC handler 时 `async` 易丢（export handler 的 await dialog 报 TS1308）——重写带 await 的回调务必保留 async。
