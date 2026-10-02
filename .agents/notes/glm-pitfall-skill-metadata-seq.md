# 坑 — SKILL.md frontmatter metadata 写成列表导致 mindx 装载器整技能跳过（2026-10-02）

分类：坑/技能装载契约 ｜ 严重度：高（静默失效——安装成功但技能不可见）

## 现象

用户从市场安装 agent 包（八区裁缝）后「智能体完全没有技能」。实证链：
- 包内 agent/skills/ 内嵌完整、安装器正常落盘（~/.mindx/skills/mx-plugin-dev 存在）
- agent.get 的 skills 声明正常（frontmatter 解析 OK）
- daemon skill.list 11 个，无 mx-plugin-dev —— 盘上 12 目录 - 1 失败 = 11，缺口正好一个

## 根因

SKILL.md frontmatter 的 metadata 写成了 YAML 列表：

```yaml
metadata:
   - name_zh: MindX Work 插件开发   # 错：seq
```

mindx 装载器（mindx/internal/core/skillstore/parse.go skillFrontmatter）要求 metadata 是 map（`cannot unmarshal !!seq into map[string]interface {}`）→ LoadSkillFromDir 硬错误 → loadInto 跳过该技能。正确写法：

```yaml
metadata:
  name_zh: MindX Work 插件开发      # 对：map
```

**静默性三重叠加**（为何一直没暴露）：
1. mindx-work 的技能体系不读 metadata，源头错写无感知
2. 安装路径的 ReloadSkills 会把「部分技能加载失败」作为错误返回（handleMarketInstall 会转给调用方），但技能文件已落盘——事后看盘全是好的
3. 用户视角「安装成功」与「技能可用」之间没有显式校验

## 修复与验证

- 三处同修：mindx-work/.agents/skills/mx-plugin-dev/SKILL.md、mindx-market/skills/dev/mx-plugin-dev/SKILL.md、~/.mindx/skills/mx-plugin-dev/SKILL.md（安装副本）
- 临时 go run 直调 LoadSkillFromDir 逐目录诊断（用后即删）——比读 daemon 代码猜快得多
- 触发注册表刷新不用重启 daemon：RPC `market.install {kind:'skill', name:'mx-plugin-dev', overwrite:true}` 重装即 ReloadSkills
- 终验：skill.list 12 个含 mx-plugin-dev，agent 声明交集非空

## 诊断方法论（可复用）

「声明在、文件在、清单没有」三态并存时：数盘上目录数 vs skill.list 数，差额=被跳过数；再写临时 go 程序直调装载器逐目录看错误——30 秒定位，优于静态读代码。

## 军规（新增，防再犯）

给 mindx 全局库/市场产出的技能 SKILL.md，frontmatter metadata 必须是 map 键值（name_zh/version），禁止列表形式；产出后用 `market.install` 重装一遍验证 skill.list 收录。
