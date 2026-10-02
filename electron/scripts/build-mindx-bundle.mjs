// 打包期下载随包 MindX 运行文件（机制复刻 mindx-desktop 同名脚本，用户定稿：
// App 侧不碰 daemon 的 CI——版本唯一权威 = mindx 仓库 git tag，从其 GitHub Release
// 下载产物打包）。下载内容：
//   - mindx-<version>-darwin-<goarch>.tar.gz（裸二进制，内嵌 runtime 资产）
//   - libonnxruntime（release 包不含 dylib，须额外取；取法与 mindx Dockerfile 的 linux 取法同源）
// 放入 electron/resources/mindx/ 供 electron-builder extraResources 注入安装包。
// 运行时 daemon-installer.ts 优先解压随包产物，缺失才回退在线下载——保证「安装完马上可用」
// + 全程免提权（dylib 释放到 ~/.mindx/lib，不写 /usr/local）。
// 用法: node scripts/build-mindx-bundle.mjs [--local] [darwin-<goarch> ...]
//   缺省（下载模式）：目标 darwin-amd64 darwin-arm64（两个 mac 架构都带上，体积不是关注点）。
//   --local（本地构建模式）：从本地 mindx 仓库（../../mindx）直接构建，产出与 CI
//     release.yml darwin 分支完全一致的归档——发版前本地测试不必等 CI/下载。本地前提：
//     go 1.26+ 与 brew install onnxruntime（构建机即本机）。Ort 独立包两架构均取自
//     本机 brew dylib（与 CI tar 内 dylib 同源；下载模式的微软 arm64 官方包仅该模式使用）。
// 说明: 产物约 177MB + 40MB/架构，不提交源码库（见 .gitignore）；由 pack.mjs 在打包前生成。
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

// libonnxruntime 版本对齐（同源 mindx-desktop 实证）：gorag/mindx 依赖的 onnxruntime_go v1.31.0
// 使用 ORT 1.26.0 的 C API 头（GetApi(26)，dylib 必须 ≥1.26）。微软官方 ≥1.26 的 macOS 包只发布
// arm64（1.20.0 是最后一个含 x86_64 的版本），因此两个架构来源不同：
//   - arm64：微软官方 onnxruntime-osx-arm64-1.26.0.tgz
//   - amd64：本机 Homebrew 的 x86_64 1.26.0 产物（brew install onnxruntime，App 的 mac
//     安装包本就在这台机器上构建，产物随包分发后用户无需自行安装 brew）
const ORT_VERSION = '1.26.0'
const GH_MINDX = `https://github.com/DotNetAge/mindx/releases/download/v${version}`
const GH_ORT = `https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}`

let failed = false
mkdirSync(OUT_DIR, { recursive: true })

// 版本一致性锚（写盘）：运行时 daemon-installer.ts 优先读本文件确定随包版本（目录已就绪）
writeFileSync(join(OUT_DIR, 'version.json'), JSON.stringify({ version }, null, 2), 'utf8')

// 清理历史版本残留的 mindx 归档：目录中只保留当前版本的产物。
// 不清理时运行时随包匹配虽按精确版本文件名（不会误选），但残留会白白增大安装包体积。
// onnxruntime 的 tgz 版本由 ORT_VERSION 独立管理，不在清理范围。
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
    const okMindx = buildMindxLocal(goarch)
    // Ort 独立包两架构均取自本机 brew dylib（与 CI tar 内 dylib 同源）
    const okOrt = packBrewOrt()
    if (!okMindx || !okOrt) failed = true
    continue
  }
  // 下载模式：微软的 macOS 资产命名用 arm64，与 goarch 命名一致；amd64 走本地 Homebrew 打包
  const okMindx = download(
    `${GH_MINDX}/mindx-${version}-darwin-${goarch}.tar.gz`,
    join(OUT_DIR, `mindx-${version}-darwin-${goarch}.tar.gz`)
  )
  const okOrt =
    goarch === 'arm64'
      ? download(`${GH_ORT}/onnxruntime-osx-arm64-${ORT_VERSION}.tgz`, join(OUT_DIR, `onnxruntime-osx-arm64-${ORT_VERSION}.tgz`))
      : packBrewOrt()
  if (!okMindx || !okOrt) failed = true
}

/**
 * 本地构建 mindx daemon 归档（完全照抄 mindx 仓库 .github/workflows/release.yml 的
 * darwin 分支，产出与 CI 发行产物一致）：
 *   1. embedder 模型校验（runtime/data/models/model.onnx，embed.go 构建硬前置；
 *      本地仓库收纳、不进 git，CI 干净 checkout 才需下载——本地只校验在位）；
 *   2. go build（GOOS=darwin GOARCH=<arch> CGO_ENABLED=1，-trimpath -ldflags 注入
 *      Version/Commit/BuildTime，与 CI 同参）；
 *   3. brew onnxruntime 的 libonnxruntime.* 经 cp -P（保符号链接）入 dist，模型复制入 dist；
 *   4. tar czf mindx-<ver>-darwin-<goarch>.tar.gz mindx libonnxruntime.* model.onnx
 *      （三件套布局与 CI Package 步骤一字不差）。
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

  // 1. embedder 模型（embed.go 构建硬前置）：本地仓库本就收纳了该模型（不进 git 而已），
  // CI 是干净 checkout 才需要从 HF 下载——本地构建只校验在位，绝不下载
  const modelPath = join(MINDX_REPO, 'runtime', 'data', 'models', 'model.onnx')
  if (!existsSync(modelPath)) {
    console.error(`[mindx-bundle] 本地缺失 embedder 模型：${modelPath}（该文件不进 git；放置模型文件后重试）`)
    return false
  }

  // 2. go build（CI 同参：-trimpath -ldflags 注入版本三元组）
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

  // 3. brew dylib 经 cp -P 保符号链接入 dist；embedder 模型同样复制入 dist
  // （CI Package 步骤同法：先 cp 模型进 dist 再打包）。
  // 写入前先清残留：brew dylib 是只读(444)权限，dist 留有上次产物时 cp 覆盖会被拒
  // （CI 无此问题——干净环境 dist 恒为空）；不整体清 dist，保留用户手工放置的无关文件
  let brewLib
  try {
    brewLib = execFileSync('brew', ['--prefix', 'onnxruntime'], { encoding: 'utf8' }).trim() + '/lib'
  } catch {
    console.error('[mindx-bundle] 未找到 brew（本地构建需要 brew install onnxruntime 提供 dylib）')
    return false
  }
  const dylibs = readdirSync(brewLib).filter((f) => f.startsWith('libonnxruntime.'))
  try {
    for (const f of dylibs) {
      const distEntry = join(MINDX_REPO, 'dist', f)
      rmSync(distEntry, { force: true })
      execFileSync('cp', ['-P', join(brewLib, f), distEntry], { stdio: 'ignore' })
    }
    rmSync(join(MINDX_REPO, 'dist', 'model.onnx'), { force: true })
    copyFileSync(modelPath, join(MINDX_REPO, 'dist', 'model.onnx'))
  } catch {
    console.error('[mindx-bundle] dylib/模型复制入 dist 失败')
    return false
  }

  // 4. tar 三件套（CI Package 步骤同布局）
  try {
    execFileSync('tar', ['czf', output, '-C', join(MINDX_REPO, 'dist'), 'mindx', ...dylibs, 'model.onnx'], { stdio: 'inherit' })
    execFileSync('gzip', ['-t', output], { stdio: 'ignore' })
    console.log(`[mindx-bundle] 完成 ${output} (${statSync(output).size} 字节，本地构建)`)
    return true
  } catch {
    console.error(`[mindx-bundle] 打包失败：${output}`)
    rmSync(output, { force: true })
    return false
  }
}

/**
 * 从本机 Homebrew 的 onnxruntime 安装打包 x86_64 dylib（微软不发 x86_64 的 ≥1.26 产物）。
 * 只取 libonnxruntime 三件套（版本 dylib + .1 与无后缀两个符号链接），打成的 tgz 与
 * 微软官方包保持一致的扁平命名，运行时 daemon-installer.ts 解压后 cp -P 到 ~/.mindx/lib
 * 即可保持符号链接链完整。
 */
function packBrewOrt() {
  const output = join(OUT_DIR, `onnxruntime-osx-x86_64-${ORT_VERSION}.tgz`)
  if (existsSync(output)) {
    console.log(`[mindx-bundle] 已存在 ${output}；如需重建请先删除`)
    return true
  }
  let brewLib
  try {
    brewLib = execFileSync('brew', ['--prefix', 'onnxruntime'], { encoding: 'utf8' }).trim() + '/lib'
  } catch {
    console.error('[mindx-bundle] 未找到 brew（amd64 需要 brew install onnxruntime 提供 x86_64 dylib）')
    return false
  }
  const files = ['libonnxruntime.dylib', `libonnxruntime.1.dylib`, `libonnxruntime.${ORT_VERSION}.dylib`]
  const missing = files.filter((f) => !existsSync(join(brewLib, f)))
  if (missing.length > 0) {
    console.error(`[mindx-bundle] ${brewLib} 缺少 ${missing.join(', ')}（需要 brew install onnxruntime 兼容版本）`)
    return false
  }
  try {
    execFileSync('tar', ['czf', output, '-C', brewLib, ...files], { stdio: 'inherit' })
    console.log(`[mindx-bundle] 完成 ${output} (${statSync(output).size} 字节，源自 ${brewLib})`)
    return true
  } catch {
    console.error(`[mindx-bundle] 打包失败：${output}`)
    rmSync(output, { force: true })
    return false
  }
}

process.exit(failed ? 1 : 0)
