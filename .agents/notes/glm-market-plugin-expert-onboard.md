# mindx-market 新增「八区裁缝」MindX Work 插件专家（2026-10-02）

分类：功能/角色与技能入库 ｜ 状态：已发布上线（2026-10-02 增量发布，线上验证通过）

## 发布记录（2026-10-02）

- 方式：增量发布（用户拍板「只发新增两个」）——`mkdir /tmp/mx-market-newpkgs && cp dist/{agent-…,skill-…}.mindpkg → node scripts/publish-market.mjs /tmp/mx-market-newpkgs`
- 结果：2 包上传成功；清单保留既有 468 + 新增 2 = 线上 470；mcp.json 同步刷新（version+1）
- 线上验证（curl manifest.json）：agent/mindx-work-plugin-expert（八区裁缝，skills=[mx-plugin-dev]，icon 128×128 PNG）与 skill/mx-plugin-dev 均收录
- 发布脚本要点：COS_SECRET_ID/KEY 环境变量必填（缺则 fail fast）；合并策略同 kind+name 覆盖其余保留；argDir 可指定包目录实现增量发布；上传顺序包→mcp.json→清单（清单最后防窗口期）

## 本轮交付

1. **技能入库**：mx-plugin-dev 整目录（SKILL.md + 5 references + scaffold 脚本）复制到 `mindx-market/skills/dev/mx-plugin-dev/`。复制而非移动——mindx-work 仓库内 `.agents/skills/` 的原技能保留供本仓库开发用；发布版正是上轮自包含化成果（无兄弟技能依赖），适配市场形态零改动。
2. **角色创建**：`mindx-market/agents/dev/mindx-work-plugin-expert/`（IDENTITY.md + SOUL.md）
   - 昵称「**八区裁缝**」（把插件缝进壳的八个视图区），name = mindx-work-plugin-expert，category = 产品研发
   - skills 关联：`[mx-plugin-dev]`
   - SOUL.md 四节：规格方式（四轮问卷禁猜测）/ 施工纪律（契约+UIKit+状态同步意识）/ 验收方式（证据优先）/ 边界（只做插件，改壳明确提示越界）
3. **唯一头像**：手绘 SVG（机器人裁缝：圆眼镜、天线、缝线身体、针线缝拼图、八区纹理背景）→ `qlmanage -t -s 512` 转 PNG → `sips` 转 JPEG(85) → base64 嵌 IDENTITY.md icon 字段（50127 字符 data URI，与现有角色同规格）。
4. **产物构建**：`npm run build` → 411 技能包 + 58 Agent 包；`skill-mx-plugin-dev.mindpkg` 与 `agent-mindx-work-plugin-expert.mindpkg` 均落 dist。

## mindx-market 仓库结构认知（新入库）

- 角色 = `agents/<域>/<slug>/`（IDENTITY.md frontmatter：name/nick_name/role/description/category/skills 名列表/icon data URI base64 JPEG；SOUL.md 行为准则）
- 技能 = `skills/<域>/<slug>/SKILL.md`（标准 agent skill 目录形态，references/scripts 随包）
- 发布链 = `npm run build`（build-market.mjs 打 mindpkg 到 dist/）→ `npm run publish`（publish-market.mjs 推 COS）
- 新增角色/技能后必须跑 build，否则 dist 无产物

## 实踩坑

**text_to_image 服务对某 prompt 持续返回「生成中」占位图**：同一 URL 重试 4 次（间隔 25s/40s/45s）字节数完全相同（CDN 缓存占位响应），加随机 nonce 参数也绕不过。**备用方案有效且可控**：手绘 SVG → qlmanage 转 PNG → sips 转 JPEG。判断占位图的方法：生成物字节数与首次完全一致 = 拿到的是占位不是成品；读图确认最可靠。
