<script setup lang="ts">
/**
 * Detail「终端」tab：xterm 呈现 + 主进程 pty（经 window.mxDesktop.terminal）。
 * cwd 取 chatflow currentProjectDir（跨插件以字符串服务名消费，契约 §10.2
 * 禁止跨插件 import），无会话回退 daemon fs.home，再回退主进程 homedir
 * （create 传空串）。DetailPane 切 tab 即卸载组件（v-if 挂载），故每次打开
 * 都是当前 cwd 的新终端，onUnmounted 杀会话；终端开着时切换会话则 watch
 * currentProjectDir 杀旧 pty 重启新会话跟随（代数校验防连续切换交错）。
 * 主题色从 CSS 变量解析：xterm 主题只认具体色值，probe 元素让浏览器把
 * var() 解析成 rgb()/rgba() 再喂给 xterm（暗色切换后重开 tab 生效）。
 */
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useService } from '@mindx-work/ui-shell-vue'

// 跨插件服务形状契约（消费侧仅声明所需形状）
interface DaemonConnectionShape {
  call<T>(method: string, params?: unknown): Promise<T>
}
interface ChatflowServiceShape {
  readonly store: { currentProjectDir: string }
}
/** 宿主桥终端段形状（类型定稿在 ui-shell desktop-bridge，此处防纯 Web 环境裸取） */
interface TerminalBridgeShape {
  create(cwd: string, cols: number, rows: number): Promise<string | null>
  write(id: string, data: string): Promise<boolean>
  resize(id: string, cols: number, rows: number): Promise<boolean>
  kill(id: string): Promise<boolean>
  onData(listener: (payload: { id: string; data: string }) => void): () => void
  onExit(listener: (payload: { id: string }) => void): () => void
}

const host = ref<HTMLDivElement | null>(null)
const chatflow = useService<ChatflowServiceShape>('chatflow.store')
const daemon = useService<DaemonConnectionShape>('daemon.connection')

let bridge: TerminalBridgeShape | null = null
let xterm: Terminal | null = null
let fitAddon: FitAddon | null = null
let sessionId: string | null = null
/** spawn 代数（连续切换时过期 spawn 自杀，防旧目录会话覆盖新会话） */
let spawnGen = 0
let observer: ResizeObserver | null = null
let offData: (() => void) | null = null
let offExit: (() => void) | null = null

/** CSS 变量 → 浏览器解析后的颜色串（xterm 不认 var()/color-mix） */
function cssColor(name: string): string {
  const probe = document.createElement('span')
  probe.style.color = `var(${name})`
  document.body.appendChild(probe)
  const value = getComputedStyle(probe).color
  probe.remove()
  return value || '#000000'
}

/** 会话 cwd：当前工作目录 → daemon 主目录 → 空串（主进程回退 homedir） */
async function resolveCwd(): Promise<string> {
  const dir = chatflow.store.currentProjectDir
  if (dir) return dir
  try {
    const home = await daemon.call<{ path: string }>('fs.home', {})
    return home.path
  } catch {
    return ''
  }
}

/** 创建 pty 会话并接线输出（代数校验：连续切换时过期 spawn 自杀，防旧目录会话覆盖新会话） */
async function spawnSession(term: Terminal): Promise<void> {
  if (!bridge) return
  const gen = ++spawnGen
  const id = await bridge.create(await resolveCwd(), term.cols, term.rows)
  if (gen !== spawnGen) {
    // spawn 期间又发生切换：本会话已过期，丢弃
    if (id) void bridge.kill(id)
    return
  }
  if (!id) {
    term.writeln('终端会话创建失败（需要 Electron 宿主环境）')
    return
  }
  sessionId = id
  offData = bridge.onData(({ id: dataId, data }) => {
    if (dataId === sessionId) term.write(data)
  })
  offExit = bridge.onExit(({ id: exitId }) => {
    if (exitId === sessionId) term.writeln('\r\n[会话已结束]')
  })
}

/** 按当前工作目录重启 pty 会话（会话切换跟随，语义同 explorer.setWorkspace） */
async function restartSession(): Promise<void> {
  if (!bridge || !xterm) return
  xterm.writeln('\r\n[工作目录已切换，重启终端会话]')
  if (sessionId) void bridge.kill(sessionId)
  sessionId = null
  offData?.()
  offData = null
  offExit?.()
  offExit = null
  await spawnSession(xterm)
}

onMounted(async () => {
  bridge = (window as unknown as { mxDesktop?: { terminal?: TerminalBridgeShape } }).mxDesktop?.terminal ?? null
  if (!bridge || !host.value) return

  const term = new Terminal({
    fontFamily:
      getComputedStyle(document.documentElement).getPropertyValue('--mx-font-mono').trim() ||
      'monospace',
    fontSize: 12,
    cursorBlink: true,
    theme: {
      background: cssColor('--mx-bg-surface'),
      foreground: cssColor('--mx-text'),
      cursor: cssColor('--mx-accent'),
      selectionBackground: cssColor('--mx-separator'),
    },
  })
  xterm = term
  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(host.value)
  fitAddon.fit()

  await spawnSession(term)

  // 键入 → pty（读 sessionId 变量本身：重启换新 id 后自动指向新会话）
  // 输出/退出接线在 spawnSession 内（退订函数收于 onUnmounted / restartSession）
  term.onData((data) => {
    if (sessionId) void bridge!.write(sessionId, data)
  })

  // 容器尺寸变化 → fit 重算行列 → 通知 pty（降级路径主进程侧忽略）
  observer = new ResizeObserver(() => {
    if (!sessionId || !fitAddon) return
    fitAddon.fit()
    void bridge!.resize(sessionId, term.cols, term.rows)
  })
  observer.observe(host.value)
  term.focus()
})

onUnmounted(() => {
  observer?.disconnect()
  observer = null
  offData?.()
  offData = null
  offExit?.()
  offExit = null
  if (sessionId && bridge) void bridge.kill(sessionId)
  sessionId = null
  xterm?.dispose()
  xterm = null
  fitAddon = null
})

// 会话切换 → currentProjectDir 变化 → 终端重启跟随（终端开着切会话的窗口；
// 切 tab 卸载重开的场景本就取新 cwd，无需此处）。初始 spawn 前后 sessionId
// 为空时跳过：spawn 用的 resolveCwd 在 create 前求值，已取最新目录。
watch(
  () => chatflow.store.currentProjectDir,
  (dir, old) => {
    if (!sessionId || !dir || dir === old) return
    void restartSession()
  }
)
</script>

<template>
  <!-- 终端容器：占满 Detail body 内容高，滚动由 xterm 自管（body 不产生双滚动条） -->
  <div ref="host" :class="$style.host" />
</template>

<style module>
.host {
  height: 100%;
  min-height: 0;
}
</style>
