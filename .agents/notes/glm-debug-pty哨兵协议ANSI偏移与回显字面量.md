# pty 哨兵协议两连坑：ANSI 偏移错位与回显哨兵字面量（2026-10-02 gitgraph 实测）

## 背景

gitgraph 插件需要跑只读 git 命令，实证结论：daemon RPC 无通用 exec（handler_registry.go 全表核对），terminal 插件走的是 `window.mxDesktop.terminal`（Electron pty 桥，spawn 交互式 `$SHELL -l`）。插件在该桥上用 BEGIN/END 哨兵协议切出干净 stdout：`printf BEGIN; git ...; printf END_$?`。

## 坑 1：原始流上的 match.index 与剥离后文本错位（P0，实测实锤）

`END_MARK_RE.exec(rawBuffer)` 的 `match.index` 是**含 ANSI 码的原始流偏移**；切片若用 `stripAnsi` 后的文本，偏移完全对不上。本机 powerlevel10k 回显一行命令带数千字节颜色码，导致 slice 终点远超真实 END 位置，提取的 output 混入 prompt 尾巴等垃圾——`rev-parse --is-inside-work-tree` 输出明明是 `true`，判定却失败，UI 表现为「当前目录不是 Git 仓库」空态（不是报错，极具迷惑性）。

**正确姿势**：先 `stripAnsi`，之后的正则匹配、index、slice 全部在剥离后的文本上做。

## 坑 2：回显里包含哨兵字面量

zsh 交互回显整条命令行，命令串里写死的 `__MXG_BEGIN__` 会原样出现在回显中，`indexOf(BEGIN_MARK)` 命中回显而非执行输出。

**正确姿势**：命令串内把哨兵拆段拼接（shell 相邻拼接语义不变）：`printf '__MXG''_BEGIN__\n'`，回显中不再有连续字面量；提取再配 `lastIndexOf` 双保险。

## 其它实证要点

- 命令写入时机无需等 shell 就绪：数据由 tty 行规程缓冲，zsh 就绪后按序执行；`run()` 内 30s 轮询哨兵天然覆盖 shell 启动慢（p10k 2-10s）。
- git 在 pty（tty 检测）下会自动上色：命令必须带 `--no-color` / `-c color.ui=false`，否则 log 输出混 SGR 码。
- 每轮 load 开一个会话轮内复用（shell 启动只等一次），用完 kill；代数计数防并发刷新交错。
- 多字节中文跨 chunk 解码乱码风险与 terminal 同级（主进程逐 chunk toString），接受。
- 实测路径：CDP 连 electron 副本（9333 + 三禁节流开关），Pinia 直注改 `chatflow-store.currentProjectDir`（普通 ref 可直改），再点 Toolbar 图标开 tab；mindx-work 仓库仅 12 提交测不了分页，切 mindx 仓库（435 提交）验证 200→400 分页与全部分支模式。
