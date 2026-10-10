<script setup lang="ts">
/**
 * 投递 modal（§4 回流路径，纯内容组件：卡片壳由 Overlay 容器提供）。
 * 对市场包投递进化版本：本地同名包（已安装的进化版）打包后上传到包主收件箱，
 * 不上货架；版本号必填（写入清单），附言可选。谱系随包延续不重声明
 * （投递目标 = 原包名，指向自身的谱系声明被 daemon 前置拦截）。
 */
import { computed, ref, watch } from 'vue'
import { useShell } from '@mindx-work/ui-shell-vue'
import { useMarketStore, pkgDisplayName } from '../store'
import { pushNotice } from '../notice'

const store = useMarketStore()
const shell = useShell()

const version = ref('0.1.0')
const note = ref('')
const submitting = ref(false)
const submitError = ref('')

const visible = computed(() => store.submitTarget !== null)
const pkg = computed(() => store.submitTarget)

watch(visible, (v) => {
  if (!v) return
  version.value = '0.1.0'
  note.value = ''
  submitError.value = ''
})

function submit(): void {
  if (!pkg.value || submitting.value) return
  submitting.value = true
  submitError.value = ''
  const name = pkgDisplayName(pkg.value)
  void store
    .submitEvolution({
      kind: pkg.value.kind,
      name: pkg.value.name,
      version: version.value.trim(),
      ...(note.value.trim() ? { note: note.value.trim() } : {}),
    })
    .then((res) => {
      pushNotice(shell, 'success', `已向「${name}」包主投递 v${res.version}（收件箱待审核）`)
      close()
    })
    .catch((err: unknown) => {
      submitError.value = err instanceof Error ? err.message : '投递失败，请重试'
    })
    .finally(() => {
      submitting.value = false
    })
}

function close(): void {
  store.cancelSubmitDialog()
}
</script>

<template>
  <div v-if="visible && pkg" :class="$style.body">
    <span :class="$style.title">投递进化版本</span>
    <p :class="$style.desc">
      将本地「{{ pkgDisplayName(pkg) }}」的进化版本投递给包主审核：采纳后并入正式版本并署名贡献者，全程不经货架直接上架。
    </p>

    <label :class="$style.field">
      <span :class="$style.fieldLabel">版本号</span>
      <input v-model="version" class="mx-input" placeholder="0.1.0" spellcheck="false" />
    </label>

    <label :class="$style.field">
      <span :class="$style.fieldLabel">附言（可选）</span>
      <input v-model="note" class="mx-input" placeholder="给包主的一句话说明" spellcheck="false" @keyup.enter="submit()" />
    </label>

    <p v-if="submitError" :class="$style.error">{{ submitError }}</p>

    <div :class="$style.actions">
      <button type="button" class="mx-btn" :disabled="submitting" @click="close">取消</button>
      <button type="button" class="mx-btn mx-btn--primary" :disabled="!version.trim() || submitting" @click="submit()">
        <span v-if="submitting" class="mx-text-loading">投递中…</span>
        <template v-else>投递</template>
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

.field {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.fieldLabel {
  font: var(--mx-font-caption);
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
