<script setup lang="ts">
/**
 * 专用源邀请码输入 modal（纯内容组件：卡片壳由 Overlay 容器提供）。
 * 消费者语境统一用「邀请码」指代商户访问令牌（PAT），明文不回读不入日志。
 * 提交即换源：daemon 以「连通探测成功」为激活判据，邀请码无效或源不可达
 * 时原样抛错，错误行内展示、对话框保留待改。
 */
import { computed, ref } from 'vue'
import { useMarketStore } from '../store'

const store = useMarketStore()

const patInput = ref('')
const connecting = ref(false)
const connectError = ref('')

const visible = computed(() => store.patDialogSourceId !== '')

function close() {
  patInput.value = ''
  connectError.value = ''
  store.cancelPatDialog()
}

async function connect() {
  const pat = patInput.value.trim()
  if (!pat) return
  connecting.value = true
  connectError.value = ''
  try {
    await store.connectMerchant(store.patDialogSourceId, pat)
    close()
  } catch (err: unknown) {
    connectError.value = err instanceof Error ? err.message : '连接失败，请检查邀请码'
  } finally {
    connecting.value = false
  }
}
</script>

<template>
  <div v-if="visible" :class="$style.body">
    <span :class="$style.title">连接专用源</span>
    <p :class="$style.desc">专用源只为受邀用户开放，请输入随邀请发放的专用邀请码。</p>

    <input
      v-model="patInput"
      type="password"
      class="mx-input"
      placeholder="输入专用邀请码"
      spellcheck="false"
      @keyup.enter="connect()"
    />

    <p v-if="connectError" :class="$style.error">{{ connectError }}</p>

    <div :class="$style.actions">
      <button type="button" class="mx-btn" :disabled="connecting" @click="close">取消</button>
      <button
        type="button"
        class="mx-btn mx-btn--primary"
        :disabled="!patInput.trim() || connecting"
        @click="connect()"
      >
        <span v-if="connecting" class="mx-text-loading">连接中…</span>
        <template v-else>连接</template>
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
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
}

.error {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-state-error);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
}
</style>
