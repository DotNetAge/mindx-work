<script setup lang="ts">
/**
 * docpreview 详情面板：PDF 经 Blob URL 交 Chromium 内置查看器直出（iframe）；
 * docx/pptx/xlsx 由前端库渲染（docx-preview / pptx-preview / SheetJS）。
 * 渲染时机：open 先取数再 show，挂载即渲；文件切换（payload 变化）重渲。
 * 渲染失败转错误态不炸（降级提示保留可用性）。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useDocPreviewStore } from './store'

const store = useDocPreviewStore()

/** docx/pptx/xlsx 渲染容器（v-if 挂载后 nextTick 可取） */
const renderBox = ref<HTMLDivElement | null>(null)

const fileName = computed(() => store.currentFile.split('/').pop() || store.currentFile)

/** 渲染 Office 文档到容器（按 kind 分派；动态 import 按需加载） */
async function renderDoc(): Promise<void> {
  const box = renderBox.value
  const data = store.payload
  if (!box || !data || !store.kind || store.kind === 'pdf') return
  box.innerHTML = ''
  try {
    if (store.kind === 'docx') {
      const { renderAsync } = await import('docx-preview')
      await renderAsync(data, box, undefined, { inWrapper: false })
    } else if (store.kind === 'xlsx') {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(data, { type: 'array' })
      // 逐工作表转 HTML（数据级预览：值与合并单元格，不还原视觉样式）
      box.innerHTML = wb.SheetNames.map((name) => {
        const sheet = wb.Sheets[name]
        if (!sheet) return ''
        const html = XLSX.utils.sheet_to_html(sheet)
        return `<section class="docx-sheet"><h3>${name}</h3>${html}</section>`
      }).join('')
    } else if (store.kind === 'pptx') {
      // pptx-preview：运行时探测 init 工厂（API 不稳定，失败降级提示）
      const mod = (await import('pptx-preview')) as Record<string, unknown>
      const init = mod.init ?? mod.default
      if (typeof init !== 'function') throw new Error('渲染器不可用')
      const previewer = (init as (el: HTMLElement, opts?: unknown) => { preview(data: ArrayBuffer): void })(
        box,
        { width: box.clientWidth, height: box.clientHeight },
      )
      previewer.preview(data)
    }
  } catch (e) {
    store.error = '文档渲染失败：' + (e instanceof Error ? e.message : String(e))
  }
}

watch(
  () => [store.kind, store.payload, store.currentFile] as const,
  () => {
    void nextTick(renderDoc)
  },
  { immediate: true },
)
</script>

<template>
  <div :class="$style.panel">
    <!-- 头部：文件名 + 类别徽标 -->
    <div :class="$style.header">
      <span :class="$style.fileName" :title="store.currentFile">
        <MxIcon name="lucide:file-text" :size="16" />
        {{ fileName || '未打开文档' }}
      </span>
      <span v-if="store.kind" class="mx-tag" data-tone="neutral">{{ store.kind.toUpperCase() }}</span>
    </div>

    <!-- 加载态 -->
    <p v-if="store.loading" :class="[$style.hint, 'mx-text-loading']">正在加载文档…</p>

    <!-- 错误态（读取失败 / 渲染失败 / 不支持格式） -->
    <p v-else-if="store.error" :class="$style.error">{{ store.error }}</p>

    <!-- 空态 -->
    <p v-else-if="!store.kind" :class="$style.hint">尚未打开任何文档</p>

    <!-- PDF：Chromium 内置查看器直出 -->
    <iframe
      v-else-if="store.kind === 'pdf' && store.blobUrl"
      :src="store.blobUrl"
      :class="$style.pdfFrame"
      :title="fileName"
    />

    <!-- docx/pptx/xlsx：前端库渲染容器 -->
    <div v-else :class="$style.canvas">
      <div ref="renderBox" :class="$style.docBox" />
    </div>
  </div>
</template>

<style module>
.panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  padding: var(--mx-space-3);
}

.header {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  flex-shrink: 0;
}

.fileName {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-1);
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.pdfFrame {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: none;
  border-radius: var(--mx-radius-card);
  background: var(--mx-bg-surface);
}

.canvas {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border-radius: var(--mx-radius-card);
  background: var(--mx-bg-surface);
}

.docBox {
  min-height: 100%;
}

/* SheetJS 输出的工作表段落：轻度排版（数据预览取向） */
.docBox :global(.docx-sheet) {
  padding: var(--mx-space-3);
}

.docBox :global(.docx-sheet h3) {
  margin: 0 0 var(--mx-space-2);
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.docBox :global(.docx-sheet table) {
  border-collapse: collapse;
  font: var(--mx-font-caption);
  color: var(--mx-text);
}

.docBox :global(.docx-sheet td) {
  border: 1px solid var(--mx-border);
  padding: 2px 6px;
  white-space: nowrap;
}

.error {
  font: var(--mx-font-caption);
  color: var(--mx-state-error);
  margin: 0;
}

.hint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  margin: 0;
}
</style>
