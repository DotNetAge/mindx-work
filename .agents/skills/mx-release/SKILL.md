---
name: mx-release
description: mindx-work 发布技能。当需要为 mindx-work 打包各平台安装产物（macOS/Windows/Linux）、准备签名证书与公证、配置或排查 CI 发布、或验证发布产物时使用，涵盖本地与 CI 两条发布工作流、版本规则、证书准备、生成物清单与实证踩坑。
---

# mindx-work 发布技能

## 何时使用

- 为 mindx-work 产出可分发的安装包（macOS dmg/zip、Windows nsis、Linux AppImage/deb）。
- 准备 macOS 签名证书与公证、配置 CI 发布、验证发布产物。

界面样式、插件开发问题不在本技能（分流 mx-uikit / mx-plugin-dev）；工程架构背景读 mx-dev-guide。

## 发布工作流

### 版本规则（唯一权威 = git tag）

- App 版本 = 仓库最近可达 git tag 去 `v` 前缀：`git tag v1.2.3` → 版本 `1.2.3`。
- 无可达 tag 或 tag 非纯版本号时回退 `package.json` 的 version 并告警（不阻断）。
- package.json 的 version 字段不参与发布决策，不要手工追它。

### 本地打包

```bash
cd mindx-work
pnpm pack:mac      # macOS（双架构 dmg + zip，自动签名 + 公证，凭据见下）
pnpm pack:win      # Windows nsis
pnpm pack:linux    # Linux AppImage + deb
pnpm pack          # 三平台全打（打包机分平台跑，见 CI）
```

- 打包自动先执行 `pnpm build`（app/dist + electron/dist），无需手动构建。
- 快速验证配置用目录模式（不打 dmg，秒级到分钟级）：`node scripts/pack.mjs --mac --dir`。
- 只看命令不执行：`node scripts/pack.mjs --mac --dry-run`。
- `pack.mjs` 的纯函数（版本解析、参数解析）受 `scripts/pack.spec.mjs` 覆盖（`pnpm test`）：改动这些函数必须同步 spec 并跑绿，防止版本注入回归。
- 本机钥匙串已有 `Developer ID Application` 证书时 electron-builder 自动选用；公证凭据二选一经 shell 注入：

```bash
# 方式一（本机推荐）：notarytool 已存档凭据 profile
APPLE_KEYCHAIN_PROFILE=<profile 名> APPLE_TEAM_ID=<Team ID> pnpm pack:mac
# 方式二：Apple ID
APPLE_ID=<apple id> APPLE_APP_SPECIFIC_PASSWORD=<app 专用密码> APPLE_TEAM_ID=<Team ID> pnpm pack:mac
```

- 两者都不提供：公证自动跳过（日志 `skipped macOS notarization`），产物照常生成——这是合法的降级路径，不是错误。

### CI 打包

- 触发：推送 tag `v*` 自动跑三平台矩阵；`workflow_dispatch` 手动触发（无 tag 时回退 package.json 版本）。
- workflow：`.github/workflows/release.yml`；产物经 upload-artifact 保留（Release 上传未启用）。
- CI secrets（缺一个就少一个能力，全部可降级）：

| secret | 用途 | 缺失后果 |
| --- | --- | --- |
| `MAC_CERT_P12_BASE64` | Developer ID Application 证书（p12 的 base64） | 退化为 ad-hoc 签名，产物仅本机可跑 |
| `MAC_CERT_PASSWORD` | 导出 p12 时设置的密码 | 同上 |
| `KEYCHAIN_PASSWORD` | CI 临时钥匙串密码（任意强口令） | 同上 |
| `APPLE_ID` | 公证凭据（方式二） | 跳过公证 |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple ID 应用专用密码（appleid.apple.com 生成） | 跳过公证 |
| `APPLE_TEAM_ID` | Apple 开发者 Team ID | 跳过公证 |

- p12 的 base64 生成：`base64 -i DeveloperID.p12 | pbcopy`。

## 生成物清单

全部落在 `mindx-work/dist/`（mac 双架构各有自己的 `dist/mac/`、`dist/mac-arm64/` app 目录）：

| 文件 | 平台/用途 |
| --- | --- |
| `MindX Work-<版本>.dmg` / `-arm64.dmg` | macOS 手动安装（x64 / arm64） |
| `MindX Work-<版本>-mac.zip` / `-arm64-mac.zip` | macOS 更新源产物（electron-updater） |
| `*.blockmap` | 差分更新元数据，随 zip 一并保留 |
| `MindX Work Setup <版本>.exe` | Windows nsis 安装器 |
| `MindX Work-<版本>.AppImage` / `.deb` | Linux 通用 / Debian 系 |

## 产物验证（发布前必做，禁止跳过猜测）

```bash
# 1. Gatekeeper 评估：期望 accepted + source=Notarized Developer ID
spctl -a -vv "dist/mac-arm64/MindX Work.app"
# 2. 公证票据验证：期望 The validate action worked!
xcrun stapler validate "dist/mac-arm64/MindX Work.app"
# 3. 签名细节核对（Identifier=com.mindx.work、entitlements 三条）
codesign -dv --entitlements - "dist/mac-arm64/MindX Work.app"
```

- 渲染冒烟（真实 Electron 环境断言，禁用普通 Chrome 直开 file:// ——见坑 4）：

```bash
open -n -a "dist/mac-arm64/MindX Work.app" --args --remote-debugging-port=9223
# Playwright connect_over_cdp("http://127.0.0.1:9223") 断言 #app 有子元素、body 有文本
```

## 坑与注意事项（全部实证）

1. **electron-builder 必须在 `electron/` 子包目录执行**（pack.mjs 已处理，勿改）：在 pnpm workspace 根执行会把 app 子包误判为应用主包——asar 里打进 app 的 package.json、main 丢失，报 `Application entry file "index.js" ... not found`。
2. **files 的 `../` 越界 glob 被静默忽略**（零警告零文件）：跨包产物必须走 `extraResources`（前端产物装到 `Contents/Resources/app-dist`、系统驻留图标装到 `Contents/Resources/tray`，main.ts 用 `process.resourcesPath` 定位）。改 files 配置后必须 `asar list` 复核文件真的进了包。
3. **`npx asar extract-file` 会把解出的文件（固定文件名）落在当前目录**：绝不能在仓库根执行，会覆盖同名文件（曾覆盖根 package.json）。
4. **验证渲染不能用普通 Chrome 直开产物 index.html**：Chrome 对 file:// 页面的 module script 有 CORS 限制必报 ERR_FAILED，测不出 Electron 真实行为；用 `--remote-debugging-port` + CDP 连入断言。
5. **改动 main.ts / electron-builder.yml / vite.config 后全链路重验**：签名、公证、资源落位、渲染四项都要过（见上文验证节）。
6. **entitlements 取最小集**（jit + 可执行内存 + 网络出站）：加条目要重新公证；`allow-dyld-environment-variables`、`network.server` 等 mindx-work 当前不需要，不加。
7. **镜像已内置**：pack.mjs 注入 ELECTRON_MIRROR 与 ELECTRON_BUILDER_BINARIES_MIRROR（用户 shell 显式设置的变量优先），CI 无需另配。
8. **证书与公证 profile 的关系**：签名证书决定"能不能签"，公证凭据决定"过不过 Gatekeeper"，两者独立配置；本机钥匙串证书 electron-builder 自动发现，无需在配置里写 identity。

## 分流

- 架构/工程形态问题 → mx-dev-guide
- 打包配置本身要改（产物结构、target、entitlements）→ 改 `electron/electron-builder.yml` 或 `scripts/pack.mjs` 后，同步更新本技能
