<script setup lang="ts">
/**
 * 模型表单 modal：manual 通用表单与 Ollama 本地同步选择器共用一条目，
 * 按 store.modelFormMode 分支渲染（规格定稿）。纯内容组件，卡片壳由 Overlay 提供。
 * Ollama 分支：打开即自动同步（定稿：无手动同步按钮）；已添加模型灰显不可选；
 * 详情卡仅展示体积 / 参数量 / 量化 / 模型家族（规格：去掉 ctx 文本）。
 */
import { computed, onMounted, ref } from 'vue'
import { useShell } from '@mindx-work/ui-shell-vue'
import { CONTEXT_LENGTH_OPTIONS, useModelsStore } from '../store'
import { pushNotice } from '../notice'
import { MODAL_MODEL_FORM } from '../ids'

const store = useModelsStore()
const shell = useShell()

const editing = computed(() => store.editingModelKey !== null)
const busy = ref(false)

/** Ollama 模型体积：字节 → 一位小数 GB */
function formatSizeGB(size: number): string {
  return `${(size / 1024 ** 3).toFixed(1)} GB`
}

function close(): void {
  shell.Overlay.remove(MODAL_MODEL_FORM)
}

/** 保存手动表单：成功关卡片推通知；失败同样关闭由 banner 呈现原因（规格定稿） */
async function save(): Promise<void> {
  busy.value = true
  const wasEditing = editing.value
  try {
    await store.saveModel()
    close()
    pushNotice(shell, 'success', wasEditing ? '模型已更新' : '模型已添加')
  } catch (err) {
    close()
    pushNotice(shell, 'error', err instanceof Error ? err.message : '保存模型失败')
  } finally {
    busy.value = false
  }
}

/** 确认添加选中的 Ollama 模型（上下文解析失败由 store 抛错，原样转 banner） */
async function confirmOllama(): Promise<void> {
  const name = store.ollamaSelected
  if (!name) return
  busy.value = true
  try {
    await store.confirmOllama()
    close()
    pushNotice(shell, 'success', `模型「${name}」已添加`)
  } catch (err) {
    close()
    pushNotice(shell, 'error', err instanceof Error ? err.message : '添加模型失败')
  } finally {
    busy.value = false
  }
}

// Ollama 分支打开即同步（组件每次打开都重新挂载，onMounted 恰好执行一次）
onMounted(() => {
  if (store.modelFormMode === 'ollama') {
    store.fetchOllama().catch((err: unknown) => {
      pushNotice(shell, 'error', err instanceof Error ? err.message : '同步本地 Ollama 模型失败')
    })
  }
})
</script>

<template>
  <!-- Ollama 分支：本地模型同步选择器 -->
  <div v-if="store.modelFormMode === 'ollama'" :class="$style.body">
    <span :class="$style.title">添加 Ollama 模型</span>
    <p v-if="store.ollamaLoading" :class="$style.hint">正在同步本地 Ollama 模型…</p>
    <div v-else-if="store.ollamaModels.length" :class="$style.ollamaList">
      <button
        v-for="m in store.ollamaModels"
        :key="m.name"
        type="button"
        :class="$style.ollamaCell"
        :data-active="store.ollamaSelected === m.name ? 'true' : 'false'"
        :disabled="store.isModelAdded(m.name)"
        @click="store.ollamaSelected = m.name"
      >
        <span :class="$style.ollamaName">{{ m.name }}</span>
        <span v-if="m.detail" :class="$style.ollamaMeta">
          {{ formatSizeGB(m.size) }} · {{ m.detail.parameter_size }} · {{ m.detail.quantization }} · {{ m.detail.model_family }}
        </span>
        <span v-else :class="$style.ollamaMeta">{{ formatSizeGB(m.size) }}</span>
        <span v-if="store.isModelAdded(m.name)" class="mx-tag" data-tone="quiet">已添加</span>
      </button>
    </div>
    <p v-else :class="$style.hint">未发现本地 Ollama 模型，请确认 Ollama 服务正在运行。</p>
    <div :class="$style.actions">
      <button type="button" class="mx-btn" :disabled="busy" @click="close">取消</button>
      <button
        type="button"
        class="mx-btn mx-btn--primary"
        :disabled="!store.ollamaSelected || busy"
        @click="confirmOllama()"
      >
        {{ busy ? '添加中…' : '添加' }}
      </button>
    </div>
  </div>

  <!-- manual 分支：通用模型表单 -->
  <div v-else :class="$style.body">
    <span :class="$style.title">{{ editing ? '编辑模型' : '添加模型' }}</span>
    <p :class="$style.hint">供应商：{{ store.selectedProvider }}</p>

    <!-- 表单分栏统一走 uikit 24 栏栅格（禁自造列宽）：两列 col-12 / 三列 col-8，
         栅格轨道 minmax(0,1fr) 防长 label（如"输入价格（￥/1M）"）托底撑破容器 -->
    <div class="mx-row">
      <label :class="$style.field" class="mx-col-12">
        <span :class="$style.fieldLabel">模型名称</span>
        <input
          v-model="store.modelForm.name"
          class="mx-input"
          :disabled="editing"
          placeholder="如 deepseek-chat"
          spellcheck="false"
        />
      </label>
      <label :class="$style.field" class="mx-col-12">
        <span :class="$style.fieldLabel">显示名</span>
        <input v-model="store.modelForm.title" class="mx-input" placeholder="列表中展示的名称" />
      </label>
    </div>

    <div class="mx-row">
      <label :class="$style.field" class="mx-col-8">
        <span :class="$style.fieldLabel">上下文长度</span>
        <select v-model="store.modelForm.contextLengthLabel" class="mx-input">
          <option v-for="o in CONTEXT_LENGTH_OPTIONS" :key="o.value" :value="o.label">{{ o.label }}</option>
        </select>
      </label>
      <label :class="$style.field" class="mx-col-8">
        <span :class="$style.fieldLabel">温度（0 – 2）</span>
        <input v-model.number="store.modelForm.temperature" type="number" min="0" max="2" step="0.1" class="mx-input" />
      </label>
      <label :class="$style.field" class="mx-col-8">
        <span :class="$style.fieldLabel">top_p（0 – 1）</span>
        <input v-model.number="store.modelForm.top_p" type="number" min="0" max="1" step="0.05" class="mx-input" />
      </label>
    </div>

    <div class="mx-row">
      <label :class="$style.field" class="mx-col-8">
        <span :class="$style.fieldLabel">输入价格（￥/1M）</span>
        <input v-model.number="store.modelForm.cost_per_1m_in" type="number" min="0" step="0.0001" class="mx-input" />
      </label>
      <label :class="$style.field" class="mx-col-8">
        <span :class="$style.fieldLabel">输出价格（￥/1M）</span>
        <input v-model.number="store.modelForm.cost_per_1m_out" type="number" min="0" step="0.0001" class="mx-input" />
      </label>
      <label :class="$style.field" class="mx-col-8">
        <span :class="$style.fieldLabel">缓存价格（￥/1M）</span>
        <input v-model.number="store.modelForm.cost_per_1m_in_cache" type="number" min="0" step="0.0001" class="mx-input" />
      </label>
    </div>

    <label :class="$style.field">
      <span :class="$style.fieldLabel">Base URL（可选）</span>
      <input v-model="store.modelForm.base_url" class="mx-input" spellcheck="false" />
    </label>

    <label :class="$style.field">
      <span :class="$style.fieldLabel">描述（可选）</span>
      <textarea v-model="store.modelForm.description" rows="2" class="mx-input" :class="$style.textarea"></textarea>
    </label>

    <!-- 能力复选：栅格两列（col-12），紧凑行距 gap-2 -->
    <div class="mx-row mx-row-gap-2">
      <label class="mx-checkbox mx-col-12"><input v-model="store.modelForm.func_calling" type="checkbox" /> 函数调用</label>
      <label class="mx-checkbox mx-col-12"><input v-model="store.modelForm.structuring" type="checkbox" /> 结构化输出</label>
      <label class="mx-checkbox mx-col-12"><input v-model="store.modelForm.web_searching" type="checkbox" /> 网页搜索</label>
      <label class="mx-checkbox mx-col-12"><input v-model="store.modelForm.visioning" type="checkbox" /> 视觉理解</label>
      <label class="mx-checkbox mx-col-12"><input v-model="store.modelForm.prefix_con" type="checkbox" /> 前缀续写</label>
      <label class="mx-checkbox mx-col-12"><input v-model="store.modelForm.context_cache" type="checkbox" /> 上下文缓存</label>
      <label class="mx-checkbox mx-col-12"><input v-model="store.modelForm.is_local" type="checkbox" /> 本地模型</label>
    </div>

    <div :class="$style.switchRow">
      <span :class="$style.switchLabel">启用</span>
      <button
        type="button"
        class="mx-switch"
        role="switch"
        :aria-checked="store.modelForm.enabled ? 'true' : 'false'"
        @click="store.modelForm.enabled = !store.modelForm.enabled"
      >
        <span class="mx-switch-thumb" />
      </button>
    </div>

    <div :class="$style.actions">
      <button type="button" class="mx-btn" :disabled="busy" @click="close">取消</button>
      <button type="button" class="mx-btn mx-btn--primary" :disabled="busy" @click="save()">
        {{ busy ? '保存中…' : '保存' }}
      </button>
    </div>
  </div>
</template>

<style module>
.body {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
}

.title {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.hint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  margin: 0;
}

.field {
  /* 栅格 item 防内容托底撑破：min-width 归零后列宽完全由栅格轨道决定 */
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.fieldLabel {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.switchRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.switchLabel {
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.textarea {
  resize: vertical;
  font: var(--mx-font-body);
}

/* Ollama 选择卡：两列栅格可滚动；选中描边 + 交互灰；已添加灰显（disabled 0.5） */
.ollamaList {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--mx-space-2);
  max-height: 320px;
  overflow-y: auto;
}

.ollamaCell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: var(--mx-space-2) var(--mx-space-3);
  text-align: left;
  background: var(--mx-bg-surface);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-card);
  cursor: pointer;
  transition:
    background-color var(--mx-duration-fast) var(--mx-ease-standard),
    border-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.ollamaCell:hover:not(:disabled) {
  background: var(--mx-hover);
}

.ollamaCell:active:not(:disabled) {
  background: var(--mx-active);
}

.ollamaCell:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 1px;
}

.ollamaCell:disabled {
  cursor: default;
  opacity: 0.5;
}

.ollamaCell[data-active='true'] {
  border-color: var(--mx-border-selected);
  background: var(--mx-hover);
}

.ollamaName {
  font: var(--mx-font-caption);
  font-weight: 500;
  color: var(--mx-text);
  overflow-wrap: anywhere;
}

.ollamaMeta {
  font: var(--mx-font-micro);
  color: var(--mx-text-tertiary);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
  margin-top: var(--mx-space-2);
}
</style>
