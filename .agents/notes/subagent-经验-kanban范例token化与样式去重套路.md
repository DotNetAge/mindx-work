# kanban 范例 token 化与样式去重套路

日期：2026-09-30 · 触发：本次任务工具调用 ≥10 次（硬信号）

## 背景

把 4 个 example.kanban（project/bug/hr/arch）的写死色全部改为 --mx-* token 并做样式去重。以下套路可复用于其余看板范例或新看板。

## Token 替换对照（已验证）

- 绿 #12b76a → var(--mx-success)；橙 #f79009 → var(--mx-warning)；红 #f04438/#ef4444 → var(--mx-danger)；蓝 #0ba5ec → var(--mx-business)；紫 #6e56cf → var(--mx-accent)
- 彩色淡底 rgba(R,G,B,.12) → color-mix(in srgb, var(--mx-对应语义) 12%, transparent)
- 中性淡底 rgba(128,128,128,x) → color-mix(in currentColor,x,transparent)
- 彩底白字 #fff/white → var(--mx-text-on-accent)
- 辅助灰字：opacity .5~.55 → color:var(--mx-text-tertiary) 并删 opacity；.6~.7 → var(--mx-text-secondary)；.75 与 .4 不在规则范围，保留原样

## 样式去重模式

- 同款部件（如 4 张统计卡 .s）提取到 board 开标签后的一个 board 级 `<style>`，选择器加前缀类 .k-s，卡挂 class="k-s"，差异色留在卡内 `<style>`（如 .k-s .n{color:var(--mx-success)}）
- 跨卡重复的徽标样式提为 .k-tag + .k-tag.k-p0/.k-p1/.k-p2（flow 卡与 table 卡共用）
- 含实例相关值（如 gantt 的 grid repeat 列数）的样式留卡内；跨卡同名但不同形的类（.bar/.track）不可合并，避免互相污染

## ECharts 卡（不认 var()）

```js
var cs = getComputedStyle(document.documentElement);
var danger = cs.getPropertyValue('--mx-danger').trim();
```

轴文字 color:'currentColor' 保留；网格线 'rgba(128,128,128,0.2)' → splitLine lineStyle { color:'currentColor', opacity:0.2 }

## 自检命令

Grep 模式 "#[0-9a-fA-F]{3,6}|rgba\\(" 对 4 文件应零命中（echarts CDN URL 不含 hex 色模式，不误报）；再数 `<card` / `</card>`、`<style` / `</style>` 开闭配对。

## 结果

4 文件写死色 16/24/14/9 处全部清零，卡数/数据/id/title 未动。kanban-spec/SKILL.md 与 card-cookbook.md 未触碰。
