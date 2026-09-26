<script setup lang="ts">
/**
 * 连接器表单 modal（新增/编辑共用；纯内容组件，卡片壳由 Overlay 容器提供）。
 * 编辑态 name 为主键不可改（防改名致凭据引用悬空）；凭据不回显（仅提示已配置，留空保持不变）。
 * 保存成功/失败都关闭并由 banner 呈现结果（同 models 表单范式）。
 */
import { computed, nextTick, onMounted, ref, useCssModule, watch } from 'vue'
import { useShell } from '@mindx-work/ui-shell-vue'
import { useConnectorsStore } from '../store'
import { pushNotice } from '../notice'
import { MODAL_CONNECTOR_FORM } from '../ids'
import KVPairEditor from './KVPairEditor.vue'
import type { MCPServerType } from '../types'

const store = useConnectorsStore()
const shell = useShell()
// script 内访问 CSS module 需显式取用（$style 仅为模板可用）
const $style = useCssModule()

const editing = computed(() => store.editingName !== null)
const busy = ref(false)

function close(): void {
  shell.Overlay.remove(MODAL_CONNECTOR_FORM)
}

async function save(): Promise<void> {
  if (!store.form.name.trim()) {
    pushNotice(shell, 'error', '请填写连接器标识')
    return
  }
  busy.value = true
  const wasEditing = editing.value
  const name = store.form.name.trim()
  try {
    await store.save()
    close()
    pushNotice(shell, 'success', wasEditing ? `连接器「${name}」已更新` : `连接器「${name}」已添加`)
  } catch (err) {
    close()
    pushNotice(shell, 'error', err instanceof Error ? err.message : '保存连接器失败')
  } finally {
    busy.value = false
  }
}

// ── 类型分段页签（.mx-tabs 指示器位移经 JS 写 transform，契约 §样式军规） ──
const tabsRef = ref<HTMLElement | null>(null)

function syncIndicator(): void {
  const root = tabsRef.value
  if (!root) return
  const tab = root.querySelector<HTMLButtonElement>('button[aria-selected="true"]')
  const ind = root.querySelector<HTMLElement>(`:scope > .${$style.indicator}`)
  if (!tab || !ind) return
  ind.style.width = `${tab.offsetWidth}px`
  ind.style.transform = `translateX(${tab.offsetLeft - 4}px)`
}

watch(
  () => store.form.type,
  () => void nextTick(syncIndicator),
)
onMounted(syncIndicator)

const TYPE_OPTIONS: Array<{ value: MCPServerType; label: string }> = [
  { value: 'stdio', label: 'stdio' },
  { value: 'sse', label: 'sse' },
  { value: 'http', label: 'http' },
]
</script>

<template>
  <div :class="$style.body">
    <span :class="$style.title">{{ editing ? '编辑连接器' : '添加连接器' }}</span>

    <label :class="$style.field">
      <span :class="$style.fieldLabel">连接器标识</span>
      <input
        v-model="store.form.name"
        class="mx-input"
        :disabled="editing"
        placeholder="小写标识，如 amap / filesystem"
        spellcheck="false"
      />
    </label>

    <div :class="$style.field">
      <span :class="$style.fieldLabel">传输类型</span>
      <div ref="tabsRef" class="mx-tabs" :class="$style.typeTabs">
        <span :class="$style.indicator" aria-hidden="true" />
        <button
          v-for="opt in TYPE_OPTIONS"
          :key="opt.value"
          type="button"
          class="mx-tab"
          role="tab"
          :aria-selected="store.form.type === opt.value ? 'true' : 'false'"
          @click="store.form.type = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <template v-if="store.form.type === 'stdio'">
      <label :class="$style.field">
        <span :class="$style.fieldLabel">启动命令</span>
        <input v-model="store.form.command" class="mx-input" placeholder="如 npx、uvx、node" spellcheck="false" />
      </label>
      <label :class="$style.field">
        <span :class="$style.fieldLabel">启动参数（空格分隔）</span>
        <input
          v-model="store.form.args"
          class="mx-input"
          placeholder="如 -y @modelcontextprotocol/server-filesystem /path"
          spellcheck="false"
        />
      </label>
    </template>
    <label v-else :class="$style.field">
      <span :class="$style.fieldLabel">服务地址</span>
      <input v-model="store.form.url" class="mx-input" placeholder="如 http://localhost:8000/sse" spellcheck="false" />
    </label>

    <!-- 环境变量（本地进程）/ 请求头（远程服务）/ 凭据（值不回显，仅提示已配置） -->
    <div :class="$style.field">
      <span :class="$style.fieldLabel">环境变量（本地进程）</span>
      <KVPairEditor v-model="store.form.env" key-placeholder="KEY" value-placeholder="VALUE" add-text="添加键值对" />
    </div>
    <div :class="$style.field">
      <span :class="$style.fieldLabel">请求头（远程服务）</span>
      <KVPairEditor v-model="store.form.headers" key-placeholder="KEY" value-placeholder="VALUE" add-text="添加键值对" />
    </div>
    <div :class="$style.field">
      <span :class="$style.fieldLabel">凭据</span>
      <KVPairEditor v-model="store.form.credential" secret add-text="添加凭据项" />
      <span v-if="store.editingHasCredential" :class="$style.hint">凭据已配置；留空表示保持现有凭据不变。</span>
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

.field {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.fieldLabel {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

/* 类型页签：三项等宽（grid 1fr 平分），indicator 为 .mx-tabs-indicator 同款几何 */
.typeTabs {
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
}

.indicator {
  position: absolute;
  inset: 4px auto 4px 4px;
  box-sizing: border-box;
  border: 0.5px solid var(--mx-border-strong);
  border-radius: 8px;
  background: var(--mx-bg-elevated);
  transition:
    transform 180ms ease,
    width 180ms ease;
  pointer-events: none;
}

.hint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
  margin-top: var(--mx-space-2);
}
</style>
