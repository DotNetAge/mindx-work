<script setup lang="ts">
/**
 * SKILL.md 编辑 modal（纯内容组件，卡片壳由 Overlay 容器提供）。
 * 挂载即读取当前技能正文（skill.list 返回的 root_dir 下 SKILL.md）；保存写回并刷新清单。
 * 保存成功/失败都关闭并由 banner 呈现结果（同 models 表单范式）。
 */
import { computed, onMounted, ref } from 'vue'
import { useShell } from '@mindx-work/ui-shell-vue'
import { useSkillsStore, skillDisplayName } from '../store'
import { pushNotice } from '../notice'
import { MODAL_SKILL_EDIT } from '../ids'

const store = useSkillsStore()
const shell = useShell()

const busy = ref(false)
const loading = ref(true)
/** 编辑目标展示名（模板内不做非空断言，归 computed） */
const editingName = computed(() => (store.editingSkill ? skillDisplayName(store.editingSkill) : ''))

onMounted(() => {
  store
    .loadEditContent()
    .catch((err: unknown) => {
      pushNotice(shell, 'error', err instanceof Error ? `读取 SKILL.md 失败：${err.message}` : '读取 SKILL.md 失败')
      shell.Overlay.remove(MODAL_SKILL_EDIT)
    })
    .finally(() => {
      loading.value = false
    })
})

function close(): void {
  shell.Overlay.remove(MODAL_SKILL_EDIT)
}

async function save(): Promise<void> {
  busy.value = true
  try {
    await store.saveEdit()
    close()
    pushNotice(shell, 'success', `技能「${skillDisplayName(store.editingSkill!)}」已保存`)
  } catch (err) {
    close()
    pushNotice(shell, 'error', err instanceof Error ? err.message : '保存失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div :class="$style.body">
    <span :class="$style.title">编辑技能：{{ editingName }}</span>
    <p v-if="loading" :class="[$style.hint, 'mx-text-loading']">正在读取 SKILL.md…</p>
    <textarea
      v-else
      v-model="store.editContent"
      :class="$style.editor"
      spellcheck="false"
      aria-label="SKILL.md 内容"
    ></textarea>
    <div :class="$style.actions">
      <button type="button" class="mx-btn" :disabled="busy" @click="close">取消</button>
      <button type="button" class="mx-btn mx-btn--primary" :disabled="busy || loading" @click="save()">
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
  min-width: 560px;
}

.title {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.hint {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

/* 正文编辑区：等宽字体，两阶段尺寸（modal 卡片壳限高内滚动） */
.editor {
  box-sizing: border-box;
  width: 100%;
  height: 420px;
  resize: vertical;
  padding: var(--mx-space-3);
  background: var(--mx-bg-window);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-control);
  font-family: var(--mx-font-family);
  font-size: var(--mx-font-caption);
  line-height: 1.6;
  color: var(--mx-text);
}

.editor:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 1px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
}
</style>
