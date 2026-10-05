// 打包期下载随包 MindX 运行文件（机制复刻 mindx-desktop 同名脚本，用户定稿：
// App 侧不碰 daemon 的 CI——版本唯一权威 = mindx 仓库 git tag，从其 GitHub Release
// 下载产物打包）。下载内容：
//   - mindx-<version>-darwin-<goarch>.tar.gz（纯 Go 裸二进制，无外部模型/动态库依赖）
// 放入 electron/resources/mindx/ 供 electron-builder extraResources 注入安装包。
// 运行时 daemon-installer.ts 优先解压随包产物，缺失才回退在线下载——保证「安装完马上可用」。
// 用法: node scripts/build-mindx-bundle.mjs [--local] [darwin-<goarch> ...]
//   缺省（下载模式）：目标 darwin-amd64 darwin-arm64（两个 mac 架构都带上，体积不是关注点）。
//   --local（本地构建模式）：从本地 mindx 仓库（../../mindx）直接构建，产出与 CI
//     release.yml darwin 分支完全一致的归档——发版前本地测试不必等 CI/下载。本地前提：
//     go 1.26+（构建机即本机）。
// 说明: 产物不提交源码库（见 .gitignore）；由 pack.mjs 在打包前生成。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveMindxVersion } from './resolve-mindx-version.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
// APP_ROOT = electron/ 子包；随包资源放 electron/resources/mindx（与 electron-builder.yml extraResources 对齐）
const APP_ROOT = join(__dirname, '..')
const OUT_DIR = join(APP_ROOT, 'resources', 'mindx')
// 本地 mindx 仓库（与 resolve-mindx-version.mjs 同一相对布局）
const MINDX_REPO = join(APP_ROOT, '..', '..', 'mindx')

const LOCAL_MODE = process.argv.includes('--local')
const targets = process.argv
  .slice(2)
  .filter((a) => !a.startsWith('--'))
  .length > 0
  ? process.argv.slice(2).filter((a) => !a.startsWith('--'))
  : ['darwin-amd64', 'darwin-arm64']
// 版本唯一权威 = mindx 仓库 git tag（与运行时兜底字面量同一解析器，天然一致）
const version = resolveMindxVersion()
if (!version) {
  console.error('[mindx-bundle] 未能解析 mindx 版本（mindx 仓库 git tag 与 daemon-installer.ts 兜底字面量均失败）')
  process.exit(1)
}

// 版本一致性锚（写盘）：运行时 daemon-installer.ts 优先读本文件确定随包版本。
// 本包构建走 tsc（无 electron-vite 的 define 注入能力），以随包 version.json 替代构建期注入。

const GH_MINDX = `https://github.com/DotNetAge/mindx/releases/download/v${version}`

let failed = false
mkdirSync(OUT_DIR, { recursive: true })

// 版本一致性锚（写盘）：运行时 daemon-installer.ts 优先读本文件确定随包版本（目录已就绪）
writeFileSync(join(OUT_DIR, 'version.json'), JSON.stringify({ version }, null, 2), 'utf8')

// 清理历史版本残留的 mindx 归档：目录中只保留当前版本的产物。
// 不清理时运行时随包匹配虽按精确版本文件名（不会误选），但残留会白白增大安装包体积。
for (const f of readdirSync(OUT_DIR)) {
  if (/^mindx-[\d.]+-/.test(f) && !f.startsWith(`mindx-${version}-`)) {
    rmSync(join(OUT_DIR, f), { force: true })
    console.log(`[mindx-bundle] 清理历史版本残留 ${f}`)
  }
}

function download(url, output) {
  if (existsSync(output)) {
    // 断点续传可能在连接被切断时仍返回 0 退出码，留下截断文件；gzip -t 做完整性
    // 校验（不解压落盘，纯流式校验），损坏则删除重下，保证产物必定可用
    try {
      execFileSync('gzip', ['-t', output], { stdio: 'ignore' })
      console.log(`[mindx-bundle] 已存在且完整 ${output} (${statSync(output).size} 字节)；如需重建请先删除`)
      return true
    } catch {
      console.warn(`[mindx-bundle] 已存在但损坏（截断），删除重下：${output}`)
      rmSync(output, { force: true })
    }
  }
  console.log(`[mindx-bundle] 下载 ${url}`)
  try {
    // curl --fail：HTTP 错误码视为失败；--location 跟随跳转；-C - 断点续传（GitHub 大文件
    // 连接不稳，重试不必从头再来）；--retry 抗网络抖动
    execFileSync(
      'curl',
      ['--fail', '--location', '--continue-at', '-', '--retry', '5', '--retry-delay', '2', '--retry-all-errors', '--connect-timeout', '15', '--output', output, url],
      { stdio: 'inherit' }
    )
    execFileSync('gzip', ['-t', output], { stdio: 'ignore' })
    console.log(`[mindx-bundle] 完成 ${output} (${statSync(output).size} 字节)`)
    return true
  } catch {
    console.error(`[mindx-bundle] 下载失败：${output}`)
    rmSync(output, { force: true })
    return false
  }
}

for (const target of targets) {
  const goarch = target.split('-')[1]
  if (goarch !== 'amd64' && goarch !== 'arm64') {
    console.error(`[mindx-bundle] 无效目标：${target}（应为 darwin-amd64 / darwin-arm64）`)
    failed = true
    continue
  }
  // 本地构建模式：直接从 mindx 仓库产出与 CI 一致的归档（不等 CI/下载）
  if (LOCAL_MODE) {
    if (!buildMindxLocal(goarch)) failed = true
    continue
  }
  // 下载模式：直接取 mindx GitHub Release 的 darwin 归档
  if (!download(
    `${GH_MINDX}/mindx-${version}-darwin-${goarch}.tar.gz`,
    join(OUT_DIR, `mindx-${version}-darwin-${goarch}.tar.gz`)
  )) failed = true
}

/**
 * 本地构建 mindx daemon 归档（完全照抄 mindx 仓库 .github/workflows/release.yml 的
 * darwin 分支，产出与 CI 发行产物一致）：
 *   1. go build（GOOS=darwin GOARCH=<arch>，-trimpath -ldflags 注入 Version/Commit/BuildTime，
 *      与 CI 同参）；
 *   2. tar czf mindx-<ver>-darwin-<goarch>.tar.gz mindx（布局与 CI Package 步骤一致）。
 * 注意：构建在 mindx 仓库 dist/ 内做（其 .gitignore 已忽略 dist），不污染源码树其它位置。
 */
function buildMindxLocal(goarch) {
  const output = join(OUT_DIR, `mindx-${version}-darwin-${goarch}.tar.gz`)
  if (existsSync(output)) {
    console.log(`[mindx-bundle] 已存在 ${output}（本地构建不覆盖；如需重建请先删除）`)
    return true
  }
  if (!existsSync(join(MINDX_REPO, 'go.mod'))) {
    console.error(`[mindx-bundle] 本地 mindx 仓库不存在（${MINDX_REPO}），无法本地构建`)
    return false
  }

  // go build（CI 同参：-trimpath -ldflags 注入版本三元组）
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: MINDX_REPO, encoding: 'utf8' }).trim()
  const buildTime = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const distBin = join(MINDX_REPO, 'dist', 'mindx')
  mkdirSync(join(MINDX_REPO, 'dist'), { recursive: true })
  console.log(`[mindx-bundle] 本地构建 mindx ${version} darwin-${goarch}（commit ${commit}）`)
  try {
    execFileSync('go', [
      'build', '-trimpath',
      `-ldflags=-s -w -X github.com/DotNetAge/mindx/internal/core.Version=${version} -X github.com/DotNetAge/mindx/internal/core.Commit=${commit} -X github.com/DotNetAge/mindx/internal/core.BuildTime=${buildTime}`,
      '-o', distBin, '.',
    ], { cwd: MINDX_REPO, stdio: 'inherit', env: { ...process.env, GOOS: 'darwin', GOARCH: goarch, CGO_ENABLED: '1' } })
  } catch {
    console.error('[mindx-bundle] go build 失败')
    return false
  }

  // tar 归档（CI Package 步骤同布局）
  try {
    execFileSync('tar', ['czf', output, '-C', join(MINDX_REPO, 'dist'), 'mindx'], { stdio: 'inherit' })
    execFileSync('gzip', ['-t', output], { stdio: 'ignore' })
    console.log(`[mindx-bundle] 完成 ${output} (${statSync(output).size} 字节，本地构建)`)
    return true
  } catch {
    console.error(`[mindx-bundle] 打包失败：${output}`)
    rmSync(output, { force: true })
    return false
  }
}

process.exit(failed ? 1 : 0)
