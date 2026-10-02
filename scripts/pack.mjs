// electron-builder 打包统一入口（机制复刻 mindx-desktop/scripts/pack.mjs）：
// 1. App 版本号从本仓库 git tag 解析注入，不依赖手工维护 package.json 的 version 字段（tag 驱动，杜绝两处漂移）；
// 2. 默认 --publish never（本地构建绝不发版）；CI 设 MX_PUBLISH=always 时改直传 GitHub Release
//    （electron-builder GitHub 发布缺省 releaseType=draft，上传后人工确认发布，杜绝意外发版）；
// 3. macOS 公证凭据缺失时注入 mxAdhoc 标记进产物 package.json——主进程 updater 按标记
//    禁用自动更新（Gatekeeper 会拦未公证更新，见 electron/src/updater.ts）；
// 4. 注入构建期下载镜像（electron 及 app-builder 工具链直连超时率高，统一走国内镜像；
//    用户 shell 里显式设置的变量优先）。
// 公证凭据不写死：electron-builder v26 从环境变量读取（两种方式二选一，见 electron-builder.yml mac 注释），
// 本地开发者在 shell 里自行 export，CI 由 workflow 从 secrets 注入。
// 用法: node scripts/pack.mjs <electron-builder 平台参数…>
//   例如: node scripts/pack.mjs --mac --win --linux（--dry-run 仅打印命令不执行）
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ── 构建期下载镜像 ──
const MIRROR_ENV = {
  ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/',
}

// 纯函数（scripts/pack.spec.mjs 覆盖）：tag → 版本号（去 v 前缀）；
// 非纯版本号返回 null，由调用方决定回退。
export function versionFromTag(tag) {
  const v = String(tag).replace(/^v/, '')
  return /^[\d.]+$/.test(v) ? v : null
}

// 纯函数：命令行参数 → { args, dryRun }（--dry-run 只作用于本脚本，不进 electron-builder 参数）
export function parsePackArgs(argv) {
  return {
    args: argv.filter((a) => !a.startsWith('--dry-run')),
    dryRun: argv.includes('--dry-run'),
  }
}

// App 版本：唯一权威 = 本仓库最近可达的 git tag（去 v 前缀）；
// 无 tag / 非版本号 tag 时回退 package.json 的 version 并告警（不阻断构建）。
function resolveAppVersion() {
  try {
    const tag = execSync('git describe --tags --abbrev=0', { cwd: ROOT, encoding: 'utf8' }).trim()
    const v = versionFromTag(tag)
    if (v) return v
    console.warn(`[pack] git tag "${tag}" 不是纯版本号，回退 package.json version`)
  } catch {
    console.warn('[pack] 仓库无可达 git tag，回退 package.json version')
  }
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
}

function main() {
  const { args, dryRun } = parsePackArgs(process.argv.slice(2))
  if (args.length === 0) {
    console.error('用法: node scripts/pack.mjs <electron-builder 参数…>\n例如: node scripts/pack.mjs --mac --win --linux')
    process.exit(1)
  }

  // 打包前构建：app/dist（vite 前端产物）+ electron/dist（主进程与 preload）
  console.log('[pack] 构建 app/dist 与 electron/dist …')
  execSync('pnpm build', { cwd: ROOT, stdio: 'inherit' })

  // 随包 daemon 产物：按 mindx 仓库 git tag 下载归档进 electron/resources/mindx（extraResources 注入）。
  // MX_NO_MINDX_BUNDLE=1 可跳过（调试打包流程时省 177MB 下载；运行时缺失回退在线下载）
  if (process.env.MX_NO_MINDX_BUNDLE === '1') {
    console.warn('[pack] MX_NO_MINDX_BUNDLE=1，跳过随包 MindX 产物下载（运行时将回退在线下载）')
  } else {
    console.log('[pack] 下载随包 MindX 智能主机产物 …')
    execSync('node scripts/build-mindx-bundle.mjs', { cwd: join(ROOT, 'electron'), stdio: 'inherit' })
  }

  const version = resolveAppVersion()
  // 发布开关：CI 设 MX_PUBLISH=always 直传 GitHub Release（draft）；缺省 never 杜绝意外发版
  const publishFlag = process.env.MX_PUBLISH === 'always' ? '--publish always' : '--publish never'
  // ad-hoc 构建标记：mac 平台公证凭据全缺失时注入（主进程按标记禁用自动更新）
  const isMac = args.includes('--mac')
  const notaryEnvMissing =
    isMac && !process.env.APPLE_ID && !process.env.APPLE_KEYCHAIN_PROFILE
  const adhocFlag = notaryEnvMissing ? ' -c.extraMetadata.mxAdhoc=true' : ''
  if (notaryEnvMissing) {
    console.warn('[pack] macOS 公证凭据缺失，注入 mxAdhoc 标记（产物禁用自动更新）')
  }
  // electron-builder 在 electron/ 子包执行：主包 = 含 main 入口的包（workspace 根跑会被误判成 app 包）
  const cmd = `npx electron-builder ${args.join(' ')} ${publishFlag} -c.extraMetadata.version=${version}${adhocFlag}`
  console.log(`[pack] App 版本 ${version}（来源：git tag）`)
  console.log(`[pack] ${cmd}`)
  if (dryRun) {
    console.log('[pack] dry-run：跳过实际打包')
    return
  }
  execSync(cmd, { cwd: join(ROOT, 'electron'), stdio: 'inherit', env: { ...MIRROR_ENV, ...process.env } })
}

// 仅直接执行时跑打包主流程；被 spec import 时只暴露纯函数
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
