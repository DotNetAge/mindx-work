<script setup lang="ts">
/**
 * kanban 详情面板：24 栏栅格（el-row/el-col）渲染仪表板卡。每卡 = iframe srcdoc
 * （sandbox="allow-scripts"：Agent 的 HTML/CSS/JS 在隔离文档中执行，无同源
 * 权限，不污染主应用）。srcdoc 注入 UIKit token 快照（宿主 :root 全部 --mx-*
 * 计算值拼 :root 块，卡内 var(--mx-*) 可用；data-mx-theme 切换即时重取跟随）、
 * board 级共享样式与 board/card class（挂卡 body，共享样式的选择器目标）。
 * 高度自适应桥：卡内 ResizeObserver postMessage 上报高度，宿主经 nonce 校验
 * 后跟随（srcdoc 本身不含高度依赖——避免重载循环）。
 * Agent 重写仪表板文件后 store 重解析，未变卡片 srcdoc 字符串相等不触发重载。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useKanbanStore, type KanbanBoard, type KanbanCard } from './store'

const store = useKanbanStore()

const board = computed(() => store.board)

/** 仪表板显示名：布局 name 优先，回退文件名去后缀 */
const boardName = computed(() => {
  const file = store.currentFile.split('/').pop() || store.currentFile
  return board.value?.name || file.replace(/.dash$/i, '')
})

// ── srcdoc 组装 ──────────────────────────────────────────────────────────────

/**
 * 卡内（iframe srcdoc）所需的全部 --mx-* 语义 token 清单。
 * 注意：不能用 getComputedStyle 枚举拿自定义属性——Electron 33（Chromium 130）
 * 的 computed style 迭代不包含 custom properties（2026-09-30 CDP 实证：
 * 枚举落空，srcdoc 只拿到保底单值，卡内 var(--mx-*) 全空导致样式回退），
 * 必须逐名显式取值。
 */
const TOKEN_NAMES = [
  // 字体
  '--mx-font-family', '--mx-font-title', '--mx-font-heading', '--mx-font-body',
  '--mx-font-caption', '--mx-font-micro', '--mx-font-brand', '--mx-font-mono',
  // 背景与表面
  '--mx-bg-window', '--mx-bg-surface', '--mx-bg-elevated', '--mx-module', '--mx-static-white',
  // 分隔与描边
  '--mx-separator', '--mx-separator-soft', '--mx-border-strong',
  // 文字
  '--mx-text', '--mx-text-secondary', '--mx-text-tertiary', '--mx-text-caption', '--mx-text-on-accent',
  // 语义色
  '--mx-accent', '--mx-business', '--mx-success', '--mx-warning', '--mx-danger',
  '--mx-state-error', '--mx-state-warn', '--mx-state-success', '--mx-state-idle',
  '--mx-state-success-soft', '--mx-state-warn-soft', '--mx-state-warn-label',
  // 交互底
  '--mx-hover', '--mx-active', '--mx-hover-solid', '--mx-btn-elevated',
  // 间距与圆角
  '--mx-space-1', '--mx-space-2', '--mx-space-3', '--mx-space-4',
  '--mx-space-5', '--mx-space-6', '--mx-space-7', '--mx-gutter',
  '--mx-radius-control', '--mx-radius-card', '--mx-radius-window',
  // 动效
  '--mx-ease-standard', '--mx-duration-fast', '--mx-duration-motion',
]

/** UIKit token 快照：按清单逐名取宿主计算值拼成 :root 块注入卡内
 * （沙箱无同源权限看不到宿主变量，注入后卡内 var(--mx-*) 才可用）。
 * 主题切换（data-mx-theme）触发重取 → 全部卡重载跟随。 */
const tokenCss = ref('')

function collectTokenCss(): void {
  const cs = getComputedStyle(document.documentElement)
  const lines: string[] = []
  for (const name of TOKEN_NAMES) {
    const value = cs.getPropertyValue(name).trim()
    if (value) lines.push(`${name}:${value}`)
  }
  if (lines.length) {
    tokenCss.value = `:root{${lines.join(';')}}`
  } else {
    // 清单全部落空的极端保底：至少给正文色（亮暗取当前计算值）
    const text = cs.getPropertyValue('--mx-text').trim() || '#1d1d1f'
    tokenCss.value = `:root{--mx-text:${text}}`
  }
}

let themeObserver: MutationObserver | null = null

onMounted(() => {
  collectTokenCss()
  themeObserver = new MutationObserver(collectTokenCss)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mx-theme'] })
})

onUnmounted(() => themeObserver?.disconnect())

/** 卡内高度上报通道：card id → px（iframe 高度跟随内容，初始用 card.h 或 120） */
const cardHeights = ref<Record<string, number>>({})

interface RenderedCard {
  card: KanbanCard
  /** 高度桥消息防伪凭证（board 每次重解析更换，旧 iframe 消息自动失效） */
  nonce: string
  doc: string
}

/** 卡内高度桥脚本（sandbox 内无同源权限，postMessage targetOrigin 用 *；
 * 宿主按 nonce 校验来源——nonce 每次 board 重解析更换，伪造/过期消息拒收）。
 * script 标签字面量必须拆串：SFC 解析器会把顶层 script 块提前切断 */
const TAG_SCRIPT_OPEN = '<scr' + 'ipt>'
const TAG_SCRIPT_CLOSE = '</scr' + 'ipt>'

function bridgeScript(cardId: string, nonce: string): string {
  return `${TAG_SCRIPT_OPEN}(function(){var r=function(){parent.postMessage({type:'kb-card-height',id:${JSON.stringify(cardId)},nonce:${JSON.stringify(nonce)},height:document.documentElement.scrollHeight},'*')};if(window.ResizeObserver){new ResizeObserver(r).observe(document.documentElement)}else{window.addEventListener('resize',r)}r()})()${TAG_SCRIPT_CLOSE}`
}

/**
 * 卡文档组装：基底样式 + UIKit token 快照（var(--mx-*) 可用）+ board 级共享
 * 样式（卡内自带 <style> 在 body 中，位置靠后可覆盖）+ body 挂 board/card
 * class（board 级样式的选择器目标）。文字色走 var(--mx-text) 随 token 快照。
 */
function buildDoc(card: KanbanCard, nonce: string, board: KanbanBoard): string {
  const classes = [...board.classes, ...card.classes]
    .map((c) => c.replace(/"/g, '&quot;'))
    .join(' ')
  const classAttr = classes ? ` class="${classes}"` : ''
  const boardStyle = board.style ? `<style>${board.style}</style>` : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang SC','Helvetica Neue',sans-serif;font-size:14px;line-height:1.5;color:var(--mx-text);overflow-wrap:break-word}</style><style>${tokenCss.value}</style>${boardStyle}</head><body${classAttr}>${card.html}${bridgeScript(card.id, nonce)}</body></html>`
}

/** 每次仪表板解析 / token 快照变化产出一组 srcdoc（nonce 随之更换） */
const rendered = computed<RenderedCard[]>(() => {
  const b = board.value
  if (!b) return []
  return b.cards.map((card) => {
    const nonce = Math.random().toString(36).slice(2)
    return { card, nonce, doc: buildDoc(card, nonce, b) }
  })
})

/** 高度桥消息接收（nonce 校验 + 数值钳制；srcdoc 不依赖高度，无重载循环） */
function onMessage(e: MessageEvent): void {
  const data = e.data as { type?: string; id?: string; nonce?: string; height?: number } | null
  if (!data || data.type !== 'kb-card-height' || typeof data.id !== 'string') return
  const hit = rendered.value.find((r) => r.card.id === data.id && r.nonce === data.nonce)
  if (!hit) return
  const h = Number(data.height)
  if (!Number.isFinite(h) || h < 0 || h > 20000) return
  cardHeights.value = { ...cardHeights.value, [data.id]: Math.ceil(h) }
}

onMounted(() => window.addEventListener('message', onMessage))
onUnmounted(() => window.removeEventListener('message', onMessage))

/** iframe 高度：卡内上报优先，未上报用 card.h，再缺省 120 */
function frameHeight(r: RenderedCard): string {
  return `${cardHeights.value[r.card.id] ?? r.card.h ?? 120}px`
}

function reload(): void {
  void store.reload()
}
</script>

<template>
  <div :class="$style.root">
    <!-- 未打开仪表板：引导空态 -->
    <div v-if="!store.currentFile && !store.loading" :class="$style.guide">
      <MxIcon name="lucide:layout-dashboard" :size="20" />
      <span :class="$style.guideTitle">没有打开的仪表板</span>
      <span :class="$style.guideDesc">
        让 Agent 为你构建仪表板——它会在当前工作区的 .agents/dashboards/ 生成仪表板文件；
        侧栏「仪表板」节列出全部可用仪表板，点击即开。
      </span>
    </div>

    <!-- 首开装载骨架（保持到内容就绪） -->
    <div v-else-if="store.loading && !board" :class="$style.skeleton">
      <el-skeleton-item v-for="i in 4" :key="i" variant="rectangle" :class="$style.skeletonCard" />
    </div>

    <!-- 打开失败（从未成功呈现过才有此态） -->
    <div v-else-if="store.error && !board" :class="$style.fail">
      <MxIcon name="lucide:circle-alert" :size="20" />
      <span :class="$style.failText">{{ store.error }}</span>
      <button type="button" :class="$style.retry" @click="reload">重试</button>
    </div>

    <template v-else-if="board">
      <!-- 头部：仪表板名 + 文件路径 + 手动刷新 -->
      <header :class="$style.head">
        <div :class="$style.headTexts">
          <span :class="$style.name">{{ boardName }}</span>
          <span :class="$style.path">{{ store.currentFile }}</span>
        </div>
        <button type="button" class="mx-icon-btn" title="刷新" @click="reload">
          <MxIcon name="lucide:refresh-cw" :size="16" />
        </button>
      </header>

      <!-- 24 栏栅格：每卡一个隔离文档（iframe srcdoc + allow-scripts） -->
      <el-row :gutter="board.gap">
        <el-col v-for="r in rendered" :key="r.card.id" :span="r.card.span" :class="$style.col">
          <div class="mx-card" :class="$style.card">
            <div v-if="r.card.title" :class="$style.cardTitle">{{ r.card.title }}</div>
            <iframe
              :srcdoc="r.doc"
              :style="{ height: frameHeight(r) }"
              :class="$style.frame"
              sandbox="allow-scripts"
              title="仪表板卡"
            ></iframe>
          </div>
        </el-col>
      </el-row>

      <!-- 空布局 -->
      <div v-if="board.cards.length === 0" :class="$style.empty">
        仪表板没有任何卡片（&lt;board&gt; 下没有 &lt;card&gt;，让 Agent 补充布局）
      </div>
    </template>
  </div>
</template>

<style module>
.root {
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-4);
  padding: var(--mx-space-4);
  overflow-y: auto;
  overflow-x: hidden;
}

/* ── 引导空态 ── */
.guide {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--mx-space-2);
  color: var(--mx-text-tertiary);
}

.guideTitle {
  font: var(--mx-font-heading);
  color: var(--mx-text-secondary);
}

.guideDesc {
  max-width: 420px;
  font: var(--mx-font-caption);
  text-align: center;
  line-height: 1.6;
}

/* ── 骨架 ── */
.skeleton {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--mx-space-3);
}

.skeletonCard {
  display: block;
  width: 100%;
  height: 96px;
  border-radius: var(--mx-radius-card);
}

/* ── 失败态 ── */
.fail {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--mx-space-2);
  color: var(--mx-state-error);
}

.failText {
  font: var(--mx-font-body);
  word-break: break-all;
}

.retry {
  padding: var(--mx-space-1) var(--mx-space-3);
  font: var(--mx-font-caption);
  color: var(--mx-text);
  background: var(--mx-btn-elevated);
  border: 0.5px solid var(--mx-border-strong);
  border-radius: var(--mx-radius-control);
  cursor: pointer;
}

.retry:hover {
  background: var(--mx-hover-solid);
}

.retry:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

/* ── 头部 ── */
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-3);
  flex-shrink: 0;
}

.headTexts {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.name {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.path {
  font: var(--mx-font-micro);
  color: var(--mx-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── 栅格与卡片 ── */
.col {
  margin-bottom: var(--mx-space-3);
}

/* 卡底 = .mx-card 原语（bg-surface + radius-card + padding 16） */
.card {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  border: 0.5px solid var(--mx-separator-soft);
}

.cardTitle {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 隔离文档视口：宽度撑满卡内，高度由卡内高度桥自适应 */
.frame {
  display: block;
  width: 100%;
  border: none;
  padding: 0;
}

.empty {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  text-align: center;
  padding: var(--mx-space-5) 0;
}
</style>
