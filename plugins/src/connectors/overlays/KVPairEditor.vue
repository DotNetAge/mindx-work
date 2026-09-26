<script setup lang="ts">
/**
 * 键值对编辑器（连接器表单内嵌组件）：env / headers / credential 三处共用。
 * 行 = 键输入 + 值输入 + 删除；键为空的行视为未完成输入，不进 model。
 * 内部行数组为唯一编辑数据源（带 uid 稳定 v-for key，防输入焦点丢失）；
 * 外部 modelValue 重置（打开编辑回填）时整表同步。
 */
import { ref, watch } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'

interface Row {
  uid: number
  key: string
  value: string
}

const props = defineProps<{
  modelValue: Record<string, string>
  /** 值输入以密码态呈现（凭据） */
  secret?: boolean
  keyPlaceholder?: string
  valuePlaceholder?: string
  addText?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: Record<string, string>] }>()

let uidSeq = 0
const rows = ref<Row[]>([])

/** 行数组序列化（与外部 model 比对用） */
function serialize(list: Row[]): string {
  const out: Record<string, string> = {}
  for (const r of list) {
    const k = r.key.trim()
    if (k) out[k] = r.value
  }
  return JSON.stringify(out)
}

/** 最近一次对外发出的序列（防止自身 emit 回流触发整表重建导致焦点丢失） */
let lastEmitted = ''

watch(
  () => props.modelValue,
  (model) => {
    if (JSON.stringify(model) === lastEmitted) return
    rows.value = Object.entries(model).map(([key, value]) => ({ uid: ++uidSeq, key, value }))
    lastEmitted = serialize(rows.value)
  },
  { immediate: true, deep: true },
)

function emitRows(): void {
  lastEmitted = serialize(rows.value)
  const out: Record<string, string> = {}
  for (const r of rows.value) {
    const k = r.key.trim()
    if (k) out[k] = r.value
  }
  emit('update:modelValue', out)
}

function addRow(): void {
  rows.value.push({ uid: ++uidSeq, key: '', value: '' })
}

function removeRow(row: Row): void {
  rows.value = rows.value.filter((r) => r.uid !== row.uid)
  emitRows()
}
</script>

<template>
  <div :class="$style.wrap">
    <div v-for="row in rows" :key="row.uid" :class="$style.row">
      <input
        v-model="row.key"
        class="mx-input"
        :class="$style.keyInput"
        :placeholder="props.keyPlaceholder || 'KEY'"
        spellcheck="false"
        @change="emitRows"
      />
      <input
        v-model="row.value"
        class="mx-input"
        :class="$style.valueInput"
        :type="props.secret ? 'password' : 'text'"
        :placeholder="props.valuePlaceholder || 'VALUE'"
        spellcheck="false"
        @change="emitRows"
      />
      <button type="button" class="mx-icon-btn" aria-label="删除此键值对" @click="removeRow(row)">
        <MxIcon name="lucide:x" :size="16" />
      </button>
    </div>
    <button type="button" class="mx-btn" :class="$style.addBtn" @click="addRow">
      <MxIcon name="lucide:plus" :size="16" />
      <span>{{ props.addText || '添加键值对' }}</span>
    </button>
  </div>
</template>

<style module>
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
}

.keyInput {
  flex: 2 1 0;
  min-width: 0;
}

.valueInput {
  flex: 3 1 0;
  min-width: 0;
}

/* 图标按钮与两枚输入框等高对齐 */
.row :global(.mx-icon-btn) {
  flex: none;
}

.addBtn {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-1);
}
</style>
