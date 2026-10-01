<script setup lang="ts">
/**
 * Detail「产物」tab 待办段：工作目录 TODO.md 的 ToDo List（增删改）。
 * - 加载：fs.read 工作目录 TODO.md；文件不存在视为空清单（首次添加时创建）
 * - 格式：标准 Markdown checkbox 行（- [ ] / - [x]，兼容 * 与大写 X）；
 *   非任务行原样保留，写回 = 全量重写（改动只落在任务行，不丢用户手写内容）
 * - 树状：缩进 2 空格一级，一级条目 = 目标、缩进子条目 = KR/任务（与 dashboard
 *   技能 OKR 场景 references/scene-okr.md 的树状映射同一套约定）
 * - 轻度标记：行尾空格分隔的 @ 词（@today/@week/@later、@doing/@defer、
 *   @ahead/@ontrack/@behind），剥出渲染为语义徽标；勾选优先于标记（已完成行
 *   不再显示徽标），@later/@doing 为缺省态剥掉不显示，未知 @ 词视为正文保留
 * - 增：清单末尾追加；删：移除该行；改：勾选切换 / 双击文本改写（标记随原文保留）
 */
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { InputInstance } from 'element-plus'
import { MxIcon, useService } from '@mindx-work/ui-shell-vue'
import { useChatflowStore } from '../store'

// 跨插件服务形状契约（消费侧仅声明所需形状；契约 §10.2 禁止跨插件 import）
interface DaemonConnectionShape {
  call<T>(method: string, params?: unknown): Promise<T>
}

/** 待办条目：idx 是 rawLines 中的行号（写回时定位替换/删除） */
interface TodoItem {
  idx: number
  done: boolean
  /** 缩进级别（2 空格一级；0 = 一级目标行） */
  level: number
  /** 显示文本（行尾标记已剥出） */
  text: string
  /** 原始任务文本（含标记，双击编辑时回填） */
  raw: string
  marks: TodoMark[]
}

/** 标记徽标：语义色 tone 对齐 dashboard 技能 scene-okr.md 的语义色映射 */
interface TodoMark {
  label: string
  tone: 'accent' | 'info' | 'ok' | 'warn' | 'danger'
}

/**
 * 行尾标记定义（与 dashboard 技能 scene-okr.md 同一套约定）。
 * null = 缺省态（@later/@doing），识别并剥出但不显示徽标；未知 @ 词不属于本表，正文保留。
 */
const MARK_DEF: Record<string, TodoMark | null> = {
  '@today': { label: '今日', tone: 'accent' },
  '@week': { label: '本周', tone: 'info' },
  '@later': null,
  '@doing': null,
  '@defer': { label: '延期', tone: 'danger' },
  '@ahead': { label: '领先', tone: 'accent' },
  '@ontrack': { label: '正常', tone: 'ok' },
  '@behind': { label: '落后', tone: 'warn' },
}

/** Markdown checkbox 行（- [ ] / - [x]；捕获组：前缀 / 完成符 / 文本尾） */
const TODO_RE = /^(\s*[-*] \[)([ xX])(\] .*)$/

const store = useChatflowStore()
const daemon = useService<DaemonConnectionShape>('daemon.connection')

/** TODO.md 原始行（写回保真的基准） */
const rawLines = ref<string[]>([])
const loading = ref(true)
const draft = ref('')

const todoPath = computed(() =>
  store.currentProjectDir ? `${store.currentProjectDir.replace(/\/+$/, '')}/TODO.md` : '',
)

/** 剥行尾标记序列：从行末向内逐个识别；遇到未知 @ 词即停（其后不是标记区，正文原样保留） */
function parseMarks(text: string): { text: string; marks: TodoMark[] } {
  const marks: TodoMark[] = []
  let rest = text
  for (;;) {
    const m = /\s+(@[a-zA-Z]+)\s*$/.exec(rest)
    if (!m) break
    const key = m[1]!.toLowerCase()
    if (!(key in MARK_DEF)) break
    const def = MARK_DEF[key]
    // 同名标记重复只取第一个（对齐 scene-okr 解析规则：每维度至多一个）
    if (def && !marks.some((mk) => mk.label === def.label)) marks.unshift(def)
    rest = rest.slice(0, m.index)
  }
  return { text: rest.trim(), marks }
}

const items = computed<TodoItem[]>(() =>
  rawLines.value.flatMap((line, idx) => {
    const m = TODO_RE.exec(line)
    if (!m) return []
    const done = m[2] !== ' '
    const raw = m[3]!.slice(2)
    const { text, marks } = parseMarks(raw)
    return [{
      idx,
      done,
      // 勾选优先于一切标记（对齐 scene-okr 解析规则）：已完成行不再显示徽标
      level: Math.floor(m[1]!.replace(/\t/g, '  ').length / 2),
      text,
      raw,
      marks: done ? [] : marks,
    }]
  }),
)

async function load(): Promise<void> {
  if (!todoPath.value) {
    rawLines.value = []
    loading.value = false
    return
  }
  loading.value = true
  try {
    const r = await daemon.call<{ content: string }>('fs.read', { path: todoPath.value })
    const body = r.content.replace(/\n+$/, '')
    rawLines.value = body ? body.split('\n') : [] // 空文件 split 会产出空行，直接归空清单
  } catch {
    rawLines.value = [] // 文件不存在 = 空清单（首次添加时创建）
  } finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
  if (!todoPath.value) return
  try {
    const content = rawLines.value.length ? rawLines.value.join('\n') + '\n' : ''
    await daemon.call('fs.write', { path: todoPath.value, content })
  } catch (e) {
    ElMessage.error(`待办保存失败：${(e as Error).message}`)
  }
}

async function addTodo(): Promise<void> {
  const text = draft.value.trim()
  if (!text || !todoPath.value) return
  rawLines.value.push(`- [ ] ${text}`)
  draft.value = ''
  await save()
}

async function toggle(item: TodoItem): Promise<void> {
  const m = TODO_RE.exec(rawLines.value[item.idx]!)
  if (!m) return
  rawLines.value[item.idx] = `${m[1]}${item.done ? ' ' : 'x'}${m[3]}`
  await save()
}

// ── 文本编辑（双击进入，enter/blur 提交、esc 取消；svgboard 文本编辑同款交互）──
const editingIdx = ref<number | null>(null)
const editText = ref('')
const editInputRef = ref<InputInstance | null>(null)

function startEdit(item: TodoItem): void {
  editingIdx.value = item.idx
  editText.value = item.raw // 回填含标记的原文，改写时标记随文本一起保留
  nextTick(() => editInputRef.value?.focus())
}

async function commitEdit(item: TodoItem): Promise<void> {
  if (editingIdx.value !== item.idx) return // enter 提交后跟随的 blur 幂等跳过
  editingIdx.value = null
  const trimmed = editText.value.trim()
  if (!trimmed || trimmed === item.raw) return
  const m = TODO_RE.exec(rawLines.value[item.idx]!)
  if (!m) return
  rawLines.value[item.idx] = `${m[1]}${m[2]}] ${trimmed}` // m[3] 含 ']'，重拼时不可丢
  await save()
}

function cancelEdit(): void {
  editingIdx.value = null
}

async function remove(item: TodoItem): Promise<void> {
  rawLines.value.splice(item.idx, 1)
  await save()
}

watch(todoPath, load, { immediate: true })
</script>

<template>
  <section :class="$style.section">
    <h3 :class="$style.sectionTitle">待办</h3>
    <p v-if="loading" :class="$style.empty">加载中…</p>
    <template v-else>
      <p v-if="!todoPath" :class="$style.empty">暂无工作目录</p>
      <template v-else>
        <p v-if="items.length === 0" :class="$style.empty">暂无待办</p>
        <div
          v-for="item in items"
          :key="item.idx"
          :class="[$style.todoRow, { [$style.done]: item.done, [$style.child]: item.level > 0 }]"
          :style="{ '--lv': item.level }"
        >
          <el-checkbox
            :model-value="item.done"
            :class="$style.check"
            @change="toggle(item)"
          />
          <span
            v-if="editingIdx !== item.idx"
            :class="$style.todoText"
            title="双击编辑"
            @dblclick="startEdit(item)"
          >
            <span :class="$style.todoLabel">{{ item.text }}</span>
            <span
              v-for="(mk, i) in item.marks"
              :key="i"
              :class="[$style.mark, $style[mk.tone]]"
            >{{ mk.label }}</span>
          </span>
          <el-input
            v-else
            ref="editInputRef"
            v-model="editText"
            :class="$style.editInput"
            @keyup.enter="commitEdit(item)"
            @blur="commitEdit(item)"
            @keydown.esc.prevent="cancelEdit"
          />
          <button type="button" :class="$style.todoDel" title="删除" @click="remove(item)">
            <MxIcon name="lucide:x" :size="16" />
          </button>
        </div>
        <el-input
          v-model="draft"
          :class="$style.addRow"
          placeholder="添加待办，回车确认"
          @keyup.enter="addTodo"
        />
      </template>
    </template>
  </section>
</template>

<style module>
/* 分隔与标题：对齐 ProductsPanel 的段样式（module 作用域不跨组件，此处重写） */
.section {
  border-top: 1px solid var(--mx-separator-soft);
  padding-top: var(--mx-space-3);
}

.sectionTitle {
  margin: 0 0 var(--mx-space-2);
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.empty {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.todoRow {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  /* 树状缩进：2 空格一级 → 每级 20px；--lv 由行内联注入 */
  padding-left: calc(var(--lv, 0) * 20px + var(--mx-space-2));
  padding-right: var(--mx-space-2);
  border-radius: var(--mx-radius-control);
}

/* 子级树引导线：1px 竖线贯穿子任务行（行连续则线连续），落在父级 checkbox 下方 */
.child::before {
  content: "";
  position: absolute;
  left: calc((var(--lv) - 1) * 20px + 8px);
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--mx-separator-soft);
}

.todoRow:hover {
  background: var(--mx-hover);
}

.check {
  height: 26px;
}

.todoText {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  flex: 1;
  min-width: 0;
  padding: var(--mx-space-1) 0;
  font: var(--mx-font-body);
  color: var(--mx-text);
  cursor: text;
}

/* 一级条目 = 目标行：中等字重区分目标与子任务（对齐 scene-okr 的 O/KR 两级心智） */
.todoRow:not(.child) .todoText {
  font-weight: 500;
}

.todoLabel {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.done .todoLabel {
  color: var(--mx-text-tertiary);
  text-decoration: line-through;
}

/* 标记徽标：语义色字 + 12% 同色淡底（与 dashboard 技能 scene-okr.md 同一套映射） */
.mark {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 16px;
  font-weight: 500;
}

.accent {
  color: var(--mx-accent);
  background: color-mix(in srgb, var(--mx-accent) 12%, transparent);
}

.info {
  color: var(--mx-business);
  background: color-mix(in srgb, var(--mx-business) 12%, transparent);
}

.ok {
  color: var(--mx-success);
  background: color-mix(in srgb, var(--mx-success) 12%, transparent);
}

.warn {
  color: var(--mx-warning);
  background: color-mix(in srgb, var(--mx-warning) 12%, transparent);
}

.danger {
  color: var(--mx-danger);
  background: color-mix(in srgb, var(--mx-danger) 12%, transparent);
}

.editInput {
  flex: 1;
  min-width: 0;
}

/* 删除按钮：hover 行内浮现的 ghost 图标（常驻可见性弱化，降噪） */
.todoDel {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  color: var(--mx-text-tertiary);
  cursor: pointer;
  opacity: 0;
}

.todoRow:hover .todoDel {
  opacity: 1;
}

.todoDel:hover {
  color: var(--mx-danger);
}

.addRow {
  margin-top: var(--mx-space-2);
}
</style>
