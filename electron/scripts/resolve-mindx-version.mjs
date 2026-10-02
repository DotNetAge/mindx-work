// 解析 mindx daemon 随包版本的共享解析器（机制复刻 mindx-desktop 同名脚本）。
// 唯一权威来源 = mindx 仓库的 git tag（App 侧不碰 daemon 的 CI，看 tag 即知版本）。
// 消费方：build-mindx-bundle.mjs（打包期下载随包产物）。
// 解析顺序：
//   1. sibling 仓库 ../../mindx（相对本 electron 包）的最近 git tag（去 v 前缀，校验纯版本号）；
//   2. 回退 daemon-installer.ts 的兜底字面量（仓库缺失 / 无 tag 场景）。
// 命令行直跑：node scripts/resolve-mindx-version.mjs（打印版本号，调试核对用）。
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// APP_ROOT = electron/ 子包（本脚本位于 electron/scripts/）
const APP_ROOT = join(__dirname, '..')
// mindx 仓库与本仓库（mindx-work）同上级目录：electron/ → mindx-work/ → ai-ecosystem/mindx
const MINDX_REPO = join(APP_ROOT, '..', '..', 'mindx')
// 兜底字面量所在的主进程安装服务源文件
const INSTALLER_TS = join(APP_ROOT, 'src', 'daemon-installer.ts')

export function resolveMindxVersion() {
  // 权威来源：mindx 仓库最近可达的 git tag
  try {
    const tag = execSync('git describe --tags --abbrev=0', { cwd: MINDX_REPO, encoding: 'utf8' }).trim()
    const v = tag.replace(/^v/, '')
    if (/^[\d.]+$/.test(v)) return v
    console.warn(`[resolve-mindx-version] mindx 仓库 tag "${tag}" 不是纯版本号，回退 daemon-installer.ts 兜底字面量`)
  } catch {
    console.warn('[resolve-mindx-version] 未找到 mindx 仓库或其 git tag，回退 daemon-installer.ts 兜底字面量')
  }
  // 兜底：daemon-installer.ts 中 resolveMindxRuntimeVersion() || 'x.y.z' 的字面量
  const src = readFileSync(INSTALLER_TS, 'utf8')
  return src.match(/resolveMindxRuntimeVersion\(\) \|\| '([\d.]+)'/)?.[1] || ''
}

// 命令行直跑：打印解析结果（供打包前置校验 / 人工核对）
if (process.argv[1] && process.argv[1].endsWith('resolve-mindx-version.mjs')) {
  const v = resolveMindxVersion()
  if (!v) {
    console.error('[resolve-mindx-version] 版本解析失败（tag 与兜底字面量均为空）')
    process.exit(1)
  }
  console.log(v)
}
