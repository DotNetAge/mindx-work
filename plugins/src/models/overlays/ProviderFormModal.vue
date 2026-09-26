<script setup lang="ts">
/**
 * 供应商表单 modal（新增/编辑共用；纯内容组件，卡片壳由 Overlay 容器提供）。
 * 编辑态 name 为主键不可改；密钥不回显（daemon 只回传已配置布尔），留空 = 保持不变。
 * 保存成功/失败都关闭并由 banner 呈现结果（规格定稿）。
 */
import { computed, ref } from 'vue'
import { useShell } from '@mindx-work/ui-shell-vue'
import { useModelsStore } from '../store'
import { pushNotice } from '../notice'
import { MODAL_PROVIDER_FORM } from '../ids'

const store = useModelsStore()
const shell = useShell()

const editing = computed(() => store.editingProviderName !== null)
const busy = ref(false)

function close(): void {
  shell.Overlay.remove(MODAL_PROVIDER_FORM)
}

async function save(): Promise<void> {
  // 用户输入边界校验：供应商标识是主键，必填
  if (!store.providerForm.name) {
    pushNotice(shell, 'error', '请填写供应商标识')
    return
  }
  busy.value = true
  const wasEditing = editing.value
  try {
    await store.saveProvider()
    close()
    pushNotice(shell, 'success', wasEditing ? '供应商已更新' : '供应商已添加')
  } catch (err) {
    close()
    pushNotice(shell, 'error', err instanceof Error ? err.message : '保存供应商失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div :class="$style.body">
    <span :class="$style.title">{{ editing ? '编辑供应商' : '添加供应商' }}</span>

    <label :class="$style.field">
      <span :class="$style.fieldLabel">供应商标识</span>
      <input
        v-model="store.providerForm.name"
        class="mx-input"
        :disabled="editing"
        placeholder="小写标识，如 ollama / deepseek"
        spellcheck="false"
      />
    </label>

    <label :class="$style.field">
      <span :class="$style.fieldLabel">显示名（可选）</span>
      <input v-model="store.providerForm.title" class="mx-input" placeholder="列表中展示的名称" />
    </label>

    <label :class="$style.field">
      <span :class="$style.fieldLabel">Base URL（可选）</span>
      <input
        v-model="store.providerForm.base_url"
        class="mx-input"
        placeholder="如 http://localhost:11434"
        spellcheck="false"
      />
    </label>

    <label :class="$style.field">
      <span :class="$style.fieldLabel">API Key</span>
      <input
        v-model="store.providerForm.api_key"
        type="password"
        class="mx-input"
        :placeholder="editing ? '留空表示保持现有密钥不变' : '供应商密钥；Ollama 等本地来源可留空'"
        autocomplete="new-password"
      />
    </label>

    <label :class="$style.field">
      <span :class="$style.fieldLabel">Auth Token（可选）</span>
      <input
        v-model="store.providerForm.auth_token"
        type="password"
        class="mx-input"
        autocomplete="new-password"
      />
    </label>

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

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
  margin-top: var(--mx-space-2);
}
</style>
