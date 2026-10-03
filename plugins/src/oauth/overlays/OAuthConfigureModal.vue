<script setup lang="ts">
/**
 * 提供商配置弹窗（第二层通用平台模板的 client_id 填入入口）。
 * 写入走凭据库（daemon 侧 oauth.provider.configure），绝不落 yml；
 * client_secret 仅机密客户端需要（可空）。保存成功关闭并联动清单刷新。
 */
import { computed, ref } from 'vue'
import { useService, useShell } from '@mindx-work/ui-shell-vue'
import type { DaemonConnection } from '../../connection/runtime'
import { configureProvider } from '../runtime'
import { oauthConfigureTarget, oauthProvidersVersion } from '../flow'
import { MODAL_OAUTH_CONFIGURE } from '../ids'

const shell = useShell()
const conn = useService<DaemonConnection>('daemon.connection')

const clientId = ref('')
const clientSecret = ref('')
const busy = ref(false)
const error = ref('')

const name = computed(() => oauthConfigureTarget.name)
const title = computed(() => oauthConfigureTarget.title || oauthConfigureTarget.name)

function close(): void {
  shell.Overlay.remove(MODAL_OAUTH_CONFIGURE)
}

async function save(): Promise<void> {
  if (!clientId.value.trim()) {
    error.value = '请填写 Client ID'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await configureProvider(conn.call, name.value, clientId.value.trim(), clientSecret.value.trim())
    oauthProvidersVersion.value += 1
    close()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div :class="$style.body">
    <span :class="$style.title">配置 {{ title }}</span>
    <p :class="$style.desc">在此填入您在 {{ title }} 平台注册应用后获得的凭据，仅保存在本机密钥库中。</p>

    <label :class="$style.field">
      <span :class="$style.fieldLabel">Client ID</span>
      <input v-model="clientId" class="mx-input" placeholder="注册应用后获得的客户端 ID" spellcheck="false" />
    </label>

    <label :class="$style.field">
      <span :class="$style.fieldLabel">Client Secret（可选）</span>
      <input
        v-model="clientSecret"
        type="password"
        class="mx-input"
        placeholder="仅机密客户端需要；公共客户端留空"
        autocomplete="new-password"
      />
    </label>

    <span v-if="error" :class="$style.error">{{ error }}</span>

    <div :class="$style.actions">
      <button type="button" class="mx-btn" :disabled="busy" @click="close()">取消</button>
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

.desc {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  line-height: 1.6;
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

.error {
  font: var(--mx-font-caption);
  color: var(--mx-state-error);
  word-break: break-all;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
  margin-top: var(--mx-space-2);
}
</style>
