---
name: mx-plugin-publish
description: mindx-work 插件发布到插件市场的工作流手册。当用户要求"发布插件 / 上架市场 / 打包插件 zip / 生成 index.json / 验证市场安装链路"时使用：发布产物规范、打包登记脚本范式、sha256 完整性、多版本登记、本机验收闭环（静态源 + env 双变量 + 断言）。
---

# 插件发布（plugin-market）

## 何时使用

- 开发完成的插件要发布到插件市场（生成 zip + 登记 index.json + 托管）时。
- 需要在本机验证市场安装链路（浏览 → 安装 → 启停 → 多代际 → 卸载全绿）时。
- 分流出口：插件开发本身 → mx-plugin-dev 技能；App 打包公证 CI → mx-release 技能；壳机制审计 → mx-audit 技能。本技能只管"从插件产物到市场上架"的链路。

## 发布模型（军规）

1. **市场是纯静态托管**：无服务端、无发布 API。发布 = 把 zip 与 index.json 放上静态源（对象存储 / CDN / 任意静态服务器）。生产定址固定，禁止自造服务端注册中心。
2. **发布产物 = 每版本一个 zip + 一份 index.json**：
   - zip 包根：`manifest.json`（id 反向域 / name / version semver 三段 / entry `.mjs` / 元数据 / `mxApiVersion`）+ `entry.mjs` + 任意资源文件。**开发产物即发布产物**（纯静态资源，无构建链，壳注入 `h` 与 `MxIcon`）。
   - index.json：`schemaVersion: 1` + `plugins[]`（元数据 + `versions: [{ version, url, sha256 }]`）。
   - 字段契约以 mx-plugin-dev `references/contract.md` §18.2/§18.6 为准，本技能不复制。
3. **sha256 是完整性军规**：登记的是 zip 文件字节哈希；主进程安装时与 index.json 期望值比对（大小写归一），失配即拒装。
4. **同版本号内容永不变更**：version 是不可变代际语义——重发布同版本号新内容会破坏已装用户的代际语义。新内容必须升版本号。
5. **多版本 = versions 数组追加**：旧版本条目保留（市场 UI 靠多版本数组提供"安装此版本"切版能力）。
6. **发布前必须本机验收全绿**（见 references/verify.md 四步闭环），未验收不得上架。
7. **dev 内网源只走 env 注入**：本机验收用 `MX_MARKET_INDEX_URL` 指向内网静态源（env 显式 = 开发者本机手势）；禁止为验收改代码放行内网（生产强制公网是 SSRF 防线）。

## 发布动作（三步）

1. **打包登记**：按 references/publish.md 脚本范式生成 zip + 计算 sha256 + 登记 index.json（追加或新建 versions 条目）。
2. **托管**：index.json 与全部 zip 上传同一静态源；确认 index.json 里每个 `url` 可公网访问。
3. **验收**：references/verify.md 四步闭环全绿后上架。

## references 索引

| 文档 | 内容 | 何时读 |
| --- | --- | --- |
| [publish.md](./references/publish.md) | 打包与登记脚本范式（通用化占位写法） | 打包 zip、登记 index.json 时 |
| [verify.md](./references/verify.md) | 本机验收闭环四步 + 坑清单 | 上架前验证安装链路时 |
