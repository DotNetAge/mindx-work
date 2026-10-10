/**
 * 官方可选件构建管线：扫描 mindx-work/.agents/plugins/<name>/（每个目录 = 一个可选件
 * 项目，plugin.json 为元数据源），逐个 vite lib 构建（SFC 编译；vue / pinia /
 * element-plus / @mindx-work/ui-shell-vue 外部化到运行期桥 shim）→ 自包含 entry.mjs
 * → manifest（plugin.json + fingerprint 重算）→ zipSync 打成 .mindpkg。
 *
 * 产物：dist-optional/<id>-<version>.mindpkg（发行搭载，用户选择式释放安装）。
 * 新增可选件 = 在 .agents/plugins/ 下新增目录（含 plugin.json），本脚本零改动。
 *
 * 用法：node scripts/optional-plugins/build.mjs [--out dist-optional]
 * 依赖：根 node_modules 的 vite / @vitejs/plugin-vue / fflate。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import process from 'node:process'
import { createRequire } from 'node:module'

// pnpm 严格模式：vite/@vitejs/plugin-vue/fflate 分别声明在 app / electron 包内，
// 脚本经 createRequire 从对应包解析（根 scripts/ 目录解析不到）
const requireApp = createRequire(path.join(import.meta.dirname, '..', '..', 'app', 'package.json'))
const requireElectron = createRequire(path.join(import.meta.dirname, '..', '..', 'electron', 'package.json'))
const requireShellVue = createRequire(path.join(import.meta.dirname, '..', '..', 'ui-shell-vue', 'package.json'))
const { build } = requireApp('vite')
const vue = requireApp('@vitejs/plugin-vue')
const { zipSync, unzipSync } = requireElectron('fflate')

// ---- 生成式 shim：从 node 端枚举 vue/pinia/element-plus 导出全集生成具名导出
//（SFC 编译注入的成员面随版本变化，枚举生成永不漏；ui-shell-vue 为 TS 源码包无法
//  require，保持手写）。fs.existsSync 守卫：仅缺文件时生成，已存在不覆写。 ----
function requireFromAny(pkg) {
  for (const req of [requireApp, requireElectron, requireShellVue]) {
    try {
      return req(pkg)
    } catch {}
  }
  throw new Error(`依赖解析失败：${pkg}（app / electron 均未声明）`)
}

function ensureGeneratedShim(pkg, file) {
  const shimPath = path.join(shimsDir, file)
  if (fs.existsSync(shimPath)) return
  const mod = requireFromAny(pkg)
  const lines = [
    `// 本文件由 build.mjs 自动生成（枚举 ${pkg} 导出全集）；请勿手改`,
    'const v = globalThis.__MINDX_BRIDGE__.' + (file === 'vue.mjs' ? 'vue' : file === 'pinia.mjs' ? 'pinia' : 'elementPlus'),
  ]
  for (const k of Object.keys(mod)) {
    if (k === 'default' || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k)) continue
    lines.push(`export const ${k} = v[${JSON.stringify(k)}]`)
  }
  lines.push('export default v')
  fs.writeFileSync(shimPath, lines.join('\n') + '\n', 'utf8')
}

function ensureStaticShims() {
  const guard = "if (!bridge) {\n  throw new Error('运行期桥缺失：__MINDX_BRIDGE__ 未挂载（可选件必须在 MindX Work 壳内激活）')\n}\n"
  // element-plus 需要在桥就位前可加载（桥 elementPlus 段），生成式同样适用
  ensureGeneratedShim('vue', 'vue.mjs')
  ensureGeneratedShim('pinia', 'pinia.mjs')
  ensureGeneratedShim('element-plus', 'element-plus.mjs')
}

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const pluginsRoot = path.join(repoRoot, '.agents', 'plugins')
const outArg = process.argv.slice(2).filter(a => !a.startsWith('--'))[0]
const outDir = path.resolve(outArg || path.join(repoRoot, 'dist-optional'))
const shimsDir = path.join(import.meta.dirname, 'shims')

const PLUGIN_ID_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/
const PLUGIN_VERSION_RE = /^\d+\.\d+\.\d+$/
const MX_API_VERSION = '1'

/** 指纹与 mindx-market 服务端 manifestbuild.PluginFingerprint 逐字节一致 */
function pluginFingerprint(id, author, version) {
  return crypto.createHash('sha256').update(JSON.stringify({ author, id, version }), 'utf8').digest('hex')
}

// 外部依赖 → 桥 shim（可选件运行期从 window.__MINDX_BRIDGE__ 解构，见 shims/*.mjs）
const EXTERNALS = ['vue', 'pinia', 'element-plus', '@mindx-work/ui-shell', '@mindx-work/ui-shell-vue']
const SHIM_FILES = {
  vue: 'vue.mjs',
  pinia: 'pinia.mjs',
  'element-plus': 'element-plus.mjs',
  '@mindx-work/ui-shell': 'ui-shell.mjs',
  '@mindx-work/ui-shell-vue': 'ui-shell-vue.mjs',
}
const ALIAS = Object.fromEntries(EXTERNALS.map(name => [name, path.join(shimsDir, SHIM_FILES[name])]))

/**
 * SFC 样式内联插件：vite 默认把 <style> 提取为独立 .css asset，而 .mindpkg 单文件
 * 管线只携带 entry.mjs——规则本体必须回填进 entry（style 标签运行时注入），否则组件
 * 类名映射在、样式规则丢（症状 = 样式全没）。同 id 旧标签先删再注（升级重激活幂等单份）。
 */
function inlineCss(pluginId) {
  return {
    name: 'mw-inline-css',
    generateBundle(_, bundle) {
      let css = ''
      for (const [name, f] of Object.entries(bundle)) {
        if (f.type === 'asset' && name.endsWith('.css')) {
          css += f.source
          delete bundle[name]
        }
      }
      if (!css) return
      for (const f of Object.values(bundle)) {
        if (f.type === 'chunk' && f.isEntry) {
          f.code =
            `(()=>{const K=${JSON.stringify(pluginId)};document.querySelectorAll('style[data-mx-plugin-style="'+K+'"]').forEach(n=>n.remove());` +
            `const s=document.createElement('style');s.setAttribute('data-mx-plugin-style',K);` +
            `s.textContent=${JSON.stringify(css)};document.head.appendChild(s)})();\n` +
            f.code
          break
        }
      }
    },
  }
}

async function buildOne(dir) {
  const metaPath = path.join(dir, 'plugin.json')
  if (!fs.existsSync(metaPath)) throw new Error('缺少 plugin.json（可选件元数据源）')
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  const issues = []
  if (typeof meta.id !== 'string' || !PLUGIN_ID_RE.test(meta.id)) issues.push('id 必须是至少两段的反向域小写 id')
  if (typeof meta.version !== 'string' || !PLUGIN_VERSION_RE.test(meta.version)) issues.push('version 必须是严格三段 semver')
  if (typeof meta.name !== 'string' || !meta.name.trim()) issues.push('name 不能为空')
  if (typeof meta.author !== 'string' || !meta.author.trim()) issues.push('author 不能为空')
  if (typeof meta.license !== 'string' || !meta.license.trim()) issues.push('license 不能为空')
  if (meta.entry !== 'entry.mjs') issues.push('entry 固定为 entry.mjs（构建产物）')
  if (meta.mxApiVersion !== MX_API_VERSION) issues.push(`mxApiVersion 必须为 ${MX_API_VERSION}`)
  if (typeof meta.export !== 'string' || !meta.export.trim()) issues.push('export 不能为空（插件命名导出函数名）')
  if (!fs.existsSync(path.join(dir, 'index.ts'))) throw new Error('缺少 index.ts（可选件入口源）')
  if (issues.length > 0) throw new Error(`plugin.json 校验失败：${issues.join('；')}`)

  const tmpOut = path.join(outDir, `.build-${meta.id}`)
  const wrapperPath = path.join(dir, '.mw-wrapper.mjs')
  if (typeof meta.export !== 'string' || !meta.export.trim()) {
    throw new Error('plugin.json 缺少 export 字段（插件命名导出函数名，wrapper 静态转接 default）')
  }
  fs.writeFileSync(
    wrapperPath,
    `import { ${meta.export} } from './index.ts'\nexport default ${meta.export}\n`,
    'utf8',
  )
  await build({
    root: dir,
    configFile: false,
    logLevel: 'warn',
    plugins: [vue()],
    resolve: { alias: ALIAS },
    build: {
      outDir: tmpOut,
      emptyOutDir: true,
      write: true,
      minify: 'esbuild',
      rollupOptions: {
        // wrapper 统一转接：插件源码保持命名导出（xxxPlugin），对外契约是 default；
        // 不设 external——依赖经 alias 进 shim 模块一并打入（shim 运行期从桥解构）
        input: wrapperPath,
        preserveEntrySignatures: 'strict',
        plugins: [inlineCss(meta.id)],
        output: {
          format: 'es',
          entryFileNames: 'entry.mjs',
          // 单文件：SFC 样式/资源内联，不拆 chunk
          inlineDynamicImports: true,
        },
      },
    },
  })

  const entryPath = path.join(tmpOut, 'entry.mjs')
  if (!fs.existsSync(entryPath)) throw new Error('构建产物缺失 entry.mjs')
  // 样式内联自检：SFC 样式必须已收割进 entry（构建目录残留 .css asset = 内联失败，
  // 打包即丢样式——曾因只携带 entry.mjs 导致三个可选件装上后样式全没）
  const leftovers = fs.readdirSync(tmpOut, { recursive: true }).filter(f => String(f).endsWith('.css'))
  if (leftovers.length > 0) throw new Error(`样式内联失败：构建目录残留 ${leftovers.join('、')}`)
  const entryBytes = new Uint8Array(fs.readFileSync(entryPath))

  const fingerprint = pluginFingerprint(meta.id, meta.author, meta.version)
  const manifest = {
    id: meta.id,
    name: meta.name,
    version: meta.version,
    description: meta.description || '',
    author: meta.author,
    ...(meta.url ? { url: meta.url } : {}),
    ...(meta.repo ? { repo: meta.repo } : {}),
    license: meta.license,
    entry: 'entry.mjs',
    permissions: Array.isArray(meta.permissions) ? meta.permissions : [],
    mxApiVersion: MX_API_VERSION,
    fingerprint,
  }

  const files = { 'entry.mjs': entryBytes, 'manifest.json': new Uint8Array(Buffer.from(JSON.stringify(manifest, null, 2))) }
  const pkgPath = path.join(outDir, `${meta.id}-${meta.version}.mindpkg`)
  fs.writeFileSync(pkgPath, Buffer.from(zipSync(files)))

  // 回读自检（fflate 中央目录读 manifest.json，与发布/安装同一解析语义）
  const inner = JSON.parse(new TextDecoder().decode(unzipSync(fs.readFileSync(pkgPath))['manifest.json']))
  if (inner.id !== meta.id || inner.version !== meta.version || inner.fingerprint !== fingerprint) {
    throw new Error(`自检失败：${path.basename(pkgPath)} 清单与预期不符`)
  }
  fs.rmSync(tmpOut, { recursive: true, force: true })
  fs.rmSync(wrapperPath, { force: true })
  return { id: meta.id, version: meta.version, pkgPath, sha256: crypto.createHash('sha256').update(Buffer.from(zipSync(files))).digest('hex') }
}

// ---- 主流程 ----

if (!fs.existsSync(pluginsRoot)) {
  console.error(`可选件源目录不存在：${pluginsRoot}`)
  process.exit(1)
}
const dirs = fs
  .readdirSync(pluginsRoot, { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith('.'))
  .map(e => path.join(pluginsRoot, e.name))
if (dirs.length === 0) {
  console.log('没有可选件目录（.agents/plugins/ 为空），跳过构建')
  process.exit(0)
}

ensureStaticShims()
fs.mkdirSync(outDir, { recursive: true })
for (const old of fs.readdirSync(outDir).filter(f => f.endsWith('.mindpkg'))) {
  fs.rmSync(path.join(outDir, old))
}

const results = []
const failures = []
for (const dir of dirs) {
  const label = path.relative(repoRoot, dir)
  try {
    results.push(await buildOne(dir))
    console.log(`已构建：${label} → ${path.basename(results.at(-1).pkgPath)}`)
  } catch (err) {
    failures.push(`${label}：${err instanceof Error ? err.message : String(err)}`)
  }
}
if (failures.length > 0) {
  console.error(`构建失败（${failures.length} 个可选件）：`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
const requirePkg = requireApp('./package.json')
console.log(`可选件构建完成：${results.length} 个 → ${outDir}（app 版本 ${requirePkg.version}）`)
