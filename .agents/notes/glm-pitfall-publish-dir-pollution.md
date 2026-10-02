# 事故复盘 — 发布源目录污染回滚线上新包（2026-10-02）＋ 积木大师重塑记

分类：事故复盘/发布纪律＋角色命名 ｜ 关联：mindx-market/AGENTS.md、docs/market-package-spec.md

## 事故：发布源目录污染 → 线上新包被静默回滚

**现象**：积木大师版（昵称+头像改版）agent 包 publish 后，RPC market.install 装出来的仍是旧昵称「八区裁缝」。

**排查链**（层层排除了三个看似合理的嫌疑）：
1. bundle.Install 覆盖语义？——overwrite:true 时 IDENTITY.md 无条件覆盖写，代码没问题
2. handleMarketInstall 漏 Reload？——ReloadAgents/ReloadSkills 都在
3. Download 缓存复用旧包？——缓存包确实是旧的，但缓存命中要求 sha256 与清单一致……

**真凶**：验证用下载副本 check.mindpkg（旧版内容）留在发布源目录 /tmp/mx-market-newpkgs 里。publish 全量上传该目录，远端 key 按 kind/name 推导 → agent 新包（fa3bca8b）先上传，check（0b1bcae7 旧版）紧随其后**覆盖回同一个 key**，manifest 条目 sha256 也被回写成旧值。三次时间戳证据闭环：agent 传于 18:19、check 传于其后、curl 取样 18:20 恰夹在中间看到新版——一进一退，现象「时好时坏」。

**教训**：下载验证文件与发布源目录物理隔离；发布后用 sha256 核对线上包，不能只看脚本「已上传」输出。

## 积木大师重塑（用户三次纠正的沉淀）

1. 「图是你生成的」→ 头像必须从 assets/avatars 库选**未占用**图。指纹比对法（icon 与库存图各解码为 128px 灰度矩阵算均方差，diff<100 判同图）跑出 12 张未用编号，用户选定 54 号（小皇帝批平板），70.png（自造图）已从库删除。
2. 「八区裁缝跟角色不配」→ 内部黑话（八区=壳分区数）不能进昵称/消费者文案。定名「积木大师」+ description 改积木意象。给候选让用户拍板（AskUserQuestion），不再替用户起名。
3. 「安装机制要记下来」→ 已沉淀 docs/market-package-spec.md（包格式/安装机制/装载契约/展示链/验证军规）。

## 终态验证（daemon 实测）

- 线上包 sha256 fa3bca8b = dist 包，内容「积木大师」
- market.install agent overwrite → 运行期昵称积木大师、skills 声明可解析
- skill.list 12 个含 mx-plugin-dev（技能闭环维持）
