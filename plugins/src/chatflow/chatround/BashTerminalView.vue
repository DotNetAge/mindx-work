<script setup lang="ts">
import { computed } from 'vue'

/**
 * BashTerminalView — 模拟终端组件（desktop 原样平移，二期 B）。
 *
 * 在工具节点展开态下方展示 Bash 类工具调用的真实终端观感（树内消费者：
 * RunScriptNodeView 伪造 start/end 透传，形态与 tool.bash 展开态同源）：
 *   - 深色终端底色（--mx-terminal-*，对齐 monaco-vscode-api 集成终端主题）
 *   - 等宽字体 + 终端前景色
 *   - 首行 "$ <command>"（提示符高亮），执行中尾部有闪烁光标块
 *   - 下方输出 stdout（执行完成、拿到 end.result 后出现）
 *
 * 显示规则（由调用方控制渲染时机）：
 *   - 执行中：正常配色，展示命令 + 闪烁光标
 *   - 执行成功完成：终端消失（结果由执行区的 Bash 卡片承载）
 *   - 执行失败：保留并整块字体变红，便于查看失败信息
 *
 * 数据直接透传 goharness 事件形态（与 desktop 一致，保持宽容类型——
 * 调用方可传原始事件分段或伪造结构）：
 *   start: { params: { command } }
 *   end:   { result, error }
 *   status: 'executing' | 'done' | 'failed'
 */
const props = defineProps<{
  start?: { params?: Record<string, unknown> } | null
  end?: { result?: unknown; error?: unknown } | null
  status: 'executing' | 'done' | 'failed'
}>()

const isExecuting = computed(() => props.status === 'executing')
const isFailed = computed(() => props.status === 'failed')

/** Bash 命令：来自 start.params.command */
const command = computed(() => {
  const p = props.start?.params
  return typeof p?.command === 'string' ? p.command : ''
})

/** stdout：优先取 end.result 中的 stdout，其次 stderr；兼容「JSON 字符串」与「对象」两种形态 */
const stdout = computed(() => {
  const raw = props.end?.result
  if (!raw) return ''
  let obj: Record<string, unknown> | null = null
  let text = ''
  if (typeof raw === 'object') {
    obj = raw as Record<string, unknown>
  } else if (typeof raw === 'string') {
    text = raw.trim()
    if (text.startsWith('{')) {
      try {
        obj = JSON.parse(text) as Record<string, unknown>
      } catch {
        obj = null
      }
    }
  }
  if (obj && typeof obj === 'object') {
    const out = typeof obj.stdout === 'string' ? obj.stdout : ''
    const err = typeof obj.stderr === 'string' ? obj.stderr : ''
    if (out.trim()) return out.replace(/\s+$/, '')
    if (err.trim()) return err.replace(/\s+$/, '')
    return text || JSON.stringify(obj)
  }
  return text
})

/** 失败且无 stdout 时展示的报错文本（end.error） */
const errorText = computed(() =>
  isFailed.value && !stdout.value && props.end?.error ? String(props.end.error) : ''
)
</script>

<template>
  <div class="bash-terminal" :class="{ failed: isFailed }">
    <pre class="term-line term-command"><span class="term-prompt">$ </span><span class="term-cmd-text">{{ command }}</span><span v-if="isExecuting" class="term-cursor"></span></pre>
    <pre v-if="stdout" class="term-line term-stdout">{{ stdout }}</pre>
    <pre v-else-if="errorText" class="term-line term-stdout term-error">{{ errorText }}</pre>
  </div>
</template>

<style scoped>
/* 模拟终端：底色/前景/光标均取自 --mx-terminal-* token（对齐 workbench 终端配色），
   与集成终端（monaco-vscode-api）观感一致 */
.bash-terminal {
  background: var(--mx-terminal-bg);
  border: 1px solid color-mix(in srgb, var(--mx-terminal-fg) 15%, transparent);
  border-radius: var(--mx-radius-control);
  overflow: hidden;
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  line-height: 1.6;
  color: var(--mx-terminal-fg);
}

.term-line {
  margin: 0;
  padding: var(--mx-space-2) var(--mx-space-3);
  white-space: pre-wrap;
  word-break: break-all;
}

/* 命令行：提示符高亮，命令正文用终端前景色 */
.term-command {
  color: var(--mx-terminal-fg);
}
.term-prompt {
  color: var(--mx-terminal-cursor);
  font-weight: 600;
}
/* 执行失败：整块字体变红（提示符 + 命令正文 + 输出），便于定位失败信息 */
.bash-terminal.failed .term-command,
.bash-terminal.failed .term-stdout,
.bash-terminal.failed .term-prompt {
  color: var(--mx-danger);
}

/* stdout：分隔线 + 终端前景色，超高（约 12 行）滚动查看 */
.term-stdout {
  border-top: 1px solid color-mix(in srgb, var(--mx-terminal-fg) 12%, transparent);
  color: var(--mx-terminal-fg);
  max-height: calc(1.6em * 12 + 8px);
  overflow-y: auto;
}

/* 失败报错：stdout 为空时展示 end.error，用红色区分 */
.term-stdout.term-error {
  color: var(--mx-danger);
}

/* 光标块：执行中闪烁，模拟真实终端输入位置 */
.term-cursor {
  display: inline-block;
  width: 0.6em;
  height: 1.1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: var(--mx-terminal-cursor);
  animation: term-blink 1s step-start infinite;
}
.bash-terminal.failed .term-cursor {
  background: var(--mx-danger);
}
@keyframes term-blink {
  50% { opacity: 0; }
}
</style>
