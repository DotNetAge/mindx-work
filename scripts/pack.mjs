// electron-builder 打包统一入口（机制复刻 mindx-desktop/scripts/pack.mjs）：
// 1. App 版本号从本仓库 git tag 解析注入，不依赖手工维护 package.json 的 version 字段（tag 驱动，杜绝两处漂移）；
// 2. 固定 --publish never：发布/上传另行处理，杜绝 electron-builder 意外向 GitHub 发版；
// 3. 注入构建期下载镜像（electron 及 app-builder 工具链直连超时率高，统一走国内镜像；
//    用户 shell 里显式设置的变量优先）。
// 公证凭据不写死：electron-builder v26 从环境变量读取（两种方式二选一，见 electron-builder.yml mac 注释），
// 本地开发者在 shell 里自行 export，CI 由 workflow 从 secrets 注入。
// 用法: node scripts/pack.mjs <electron-builder 平台参数…>
//   例如: node scripts/pack.mjs --mac --win --linux（--dry-run 仅打印命令不执行）
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ── 构建期下载镜像 ──
const MIRROR_ENV = {
  ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/',
}

// App 版本：唯一权威 = 本仓库最近可达的 git tag（去 v 前缀）；
// 无 tag / 非版本号 tag 时回退 package.json 的 version 并告警（不阻断构建）。
function resolveAppVersion() {
  try {
    const tag = execSync('git describe --tags --abbrev=0', { cwd: ROOT, encoding: 'utf8' }).trim()
    const v = tag.replace(/^v/, '')
    if (/^[\d.]+$/.test(v)) return v
    console.warn(`[pack] git tag "${tag}" 不是纯版本号，回退 package.json version`)
  } catch {
    console.warn('[pack] 仓库无可达 git tag，回退 package.json version')
  }
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('--dry-run'))
const dryRun = process.argv.includes('--dry-run')
if (args.length === 0) {
  console.error('用法: node scripts/pack.mjs <electron-builder 参数…>\n例如: node scripts/pack.mjs --mac --win --linux')
  process.exit(1)
}

// 打包前构建：app/dist（vite 前端产物）+ electron/dist（主进程与 preload）
console.log('[pack] 构建 app/dist 与 electron/dist …')
execSync('pnpm build', { cwd: ROOT, stdio: 'inherit' })

const version = resolveAppVersion()
// electron-builder 在 electron/ 子包执行：主包 = 含 main 入口的包（workspace 根跑会被误判成 app 包）
const cmd = `npx electron-builder ${args.join(' ')} --publish never -c.extraMetadata.version=${version}`
console.log(`[pack] App 版本 ${version}（来源：git tag）`)
console.log(`[pack] ${cmd}`)
if (dryRun) {
  console.log('[pack] dry-run：跳过实际打包')
  process.exit(0)
}
execSync(cmd, { cwd: join(ROOT, 'electron'), stdio: 'inherit', env: { ...MIRROR_ENV, ...process.env } })
