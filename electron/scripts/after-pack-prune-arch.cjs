// afterPack 钩子（机制复刻 mindx-desktop 同名脚本）：extraResources 会同时带入双架构的
// daemon/onnxruntime 归档（build-mindx-bundle.mjs 缺省 darwin 双架构），本钩子在 asar 压缩前
// 删除与当前构建架构不匹配的文件，使每个安装包只携带对应架构的随包资源。
// 用法：electron-builder.yml afterPack 指向本文件（相对 electron/ 包根）。
const { join } = require('node:path')
const { readdirSync, rmSync } = require('node:fs')

module.exports = async function afterPack(context) {
  const { arch, electronPlatformName: platform, appOutDir } = context
  if (platform !== 'darwin') return // 随包资源当前只有 darwin 双架构，其它平台无裁剪对象

  // electron arch → goarch 命名（arm64/arm64、x64/amd64）
  const goarch = arch === 3 /* Arch.arm64 */ ? 'arm64' : 'amd64'
  const ortArch = goarch // 微软 osx 包命名与 goarch 一致（x86_64 包由 brew 打包时即命名 x86_64）
  const mindxDir = join(appOutDir, 'resources', 'mindx')

  let files
  try {
    files = readdirSync(mindxDir)
  } catch {
    return // 随包资源缺失（开发态漏跑 build-mindx-bundle）：运行时会回退在线下载，此处无裁剪对象
  }

  for (const f of files) {
    // mindx daemon 归档：保留 mindx-*-darwin-<当前架构>.tar.gz
    if (/^mindx-[\d.]+-darwin-(amd64|arm64)\.tar\.gz$/.test(f) && !f.endsWith(`-${goarch}.tar.gz`)) {
      rmSync(join(mindxDir, f), { force: true })
      console.log(`[after-pack-prune-arch] 裁剪非本架构随包资源 ${f}`)
      continue
    }
    // onnxruntime 归档：保留 onnxruntime-osx-<当前架构>-*.tgz（x86_64/amd64 同指 Intel）
    if (/^onnxruntime-osx-(x86_64|arm64)-[\d.]+\.tgz$/.test(f)) {
      const fArch = f.includes('x86_64') ? 'amd64' : 'arm64'
      if (fArch !== ortArch) {
        rmSync(join(mindxDir, f), { force: true })
        console.log(`[after-pack-prune-arch] 裁剪非本架构随包资源 ${f}`)
      }
    }
  }
}
