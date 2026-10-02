# 技能发布就绪改造 — mx-plugin-dev 自包含化（2026-10-02）

分类：重构/技能体系（发布就绪） ｜ 状态：已完成（lint 全过，兄弟技能引用清零 grep 验证）

## 动机（用户判断，查证属实）

技能要发布到 mindx-work 默认技能库（消费者 = 终端用户环境里的 Agent），必须可单独使用、不依赖仓库技能生态。查证发现三层问题：

1. **实锤失效路径**：SKILL/examples/spec 三处脚手架命令写 `python3 ../.skills/mx-plugin-dev/scripts/...`，但 `.skills` 目录不存在（ls 证实）——照抄即报错。正确 = `python3 .agents/skills/mx-plugin-dev/scripts/scaffold_plugin.py`（mindx-work 根执行）。已全部修复。
2. **兄弟技能悬空引用**：SKILL.md 引用 mx-uikit（军规 1 + 索引表）与 mx-dev-guide（目录地图 + market 验收链路）两技能；examples.md/contract.md 各还有一处 mx-uikit 引用。发布后消费者环境没有这些技能，全部落空。
3. **上下文噪声**：仓库维护者视角内容混在技能正文。

## 改造内容

- **mx-uikit 融入**：新增 `references/uikit.md`（mx-uikit SKILL.md 全量 + 头部同源注记「2026-10-02 快照，两处改动须双向同步」）；SKILL.md 军规 1、索引表、开发流程 L90 改指该文件。**mx-uikit 技能本体保留**（用户决策：本仓库界面开发与 mx-audit/mx-dev-guide 仍引用它）。
- **验收链路迁移**：mx-dev-guide `architecture.md` §7 的「真机验收链路」小节（四步命令 + 要点）迁为 contract.md **§18.8**；architecture.md 原位留指针。归属逻辑：机制细节统一归 contract.md（architecture.md L97 本来就这么声明）。
- **目录地图内联**：mx-dev-guide「项目级目录地图」引用 → 一段话速记（ui-shell / ui-shell-vue / plugins / app/main.ts 归属）+ 仓库路径 `docs/界面层选型.md` 指引。
- **Playwright 判据军规保留**（用户报的"噪声"之一）：判断为消费者需要的知识而非噪声——在线插件作者验收自己的插件时面对同一个 app UI（设置面板、rowLabel 同名污染同样存在），这些判据直接适用。

## 关键设计原则（沉淀）

**悬空引用 vs 仓库内路径的区分**：技能消费者必然拥有 mindx-work 本体（app/仓库），因此 `docs/`、`plugins/src/demo/` 等仓库内路径引用有效，标注「仓库内路径」语义后保留（有证据价值）；只有对**兄弟技能**（mx-uikit/mx-dev-guide/mx-audit）的引用才悬空，必须消除（内容融入或指针内联）。

## 教训

1. **技能内的可执行命令必须实测**——`.skills` 旧路径是技能目录迁移（.skills → .agents/skills）后的遗留，三处文档跟随失效却从未被发现，因为没人照着跑过。技能里任何命令路径改动都应全仓 grep 该命令模式。
2. uikit.md 初写时范式表列宽未对齐触发 MD060（IDE 诊断即时暴露）；用上轮沉淀的「header+分隔行+数据行显式三段构建」重排脚本重排即过——表格重排脚本模式已可靠复用。
