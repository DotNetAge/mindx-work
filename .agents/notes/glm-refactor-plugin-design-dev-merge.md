# 技能合并 — mx-plugin-design 收编进 mx-plugin-dev（2026-10-02）

分类：重构/技能体系 ｜ 状态：已完成（lint 通过，无残留活引用）

## 决策与理由

用户判断：两技能职能一致，只是同一工作流的两个环节，应合并。查证后同意——

1. 触发词高度重叠（两 description 都覆盖「用户想开发新插件」），并存时技能路由要做本不必要的选择
2. 互相分流引用暴露本是一体（design → dev 施工，dev → design 收规格）
3. design 产物（规格表 + scaffold 场景参数）就是 dev 流程第 1 步输入，且 design 极薄（SKILL 36 行 + 2 references）

## 实施记录

- **保留 mx-plugin-dev 名字**（19 文件引用 vs design 6 处，改动成本悬殊）
- dev SKILL.md：description 扩为「规格收集 + 施工全流程」；新增「规格收集（阶段 0）」一节（四轮问卷军规 + 结构表原文收编）；「何时使用」分流行改为内部阶段指引；索引表加 seats.md/spec.md 两行
- `seats.md`、`spec.md` 经 `git mv` 入 `mx-plugin-dev/references/`（内部无相对链接，挪动安全）；design 目录删除
- mx-dev-guide 任务分流表：design/dev 两行合并为「新插件（从零起意 / 规格收集 / 开发改造）→ mx-plugin-dev 技能」
- notes 历史记录不改写（当时事实）；未来若执行 sheet-view-region notes 的清单，seats.md 现位于 mx-plugin-dev/references/

## 实踩坑

1. **表格重排脚本按位置假定分隔行（rows[1]）会把新插入的数据行覆盖成分隔行**：正确做法是显式构建「header + 分隔行 + 数据行」三段，分隔行不参与数据解析——数据行解析后应从解析结果中剔除旧分隔行（`set(c) <= {'-'}` 判定），分隔行在输出时单独生成，绝不按索引假定。本轮已实修。
2. 表格对齐军规不变：**显示宽度（CJK=2）对齐**，非 codepoint 数；重排后必须 markdownlint 复验。
