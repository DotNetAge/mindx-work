<script setup lang="ts">
/** 任务页：插件内部状态一律 Pinia */
import { ref } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useTaskStore } from '../store'

const store = useTaskStore()
const draft = ref('')

const submit = () => {
  store.add(draft.value)
  draft.value = ''
}
</script>

<template>
  <div :class="$style.page">
    <h1 :class="$style.title">任务</h1>
    <p :class="$style.caption">插件内部状态用 Pinia 持有，与壳机制状态互不掺和。</p>

    <div :class="$style.composer">
      <input
        v-model="draft"
        type="text"
        class="mx-input"
        placeholder="添加任务…"
        @keydown.enter="submit"
      />
      <button type="button" class="mx-btn mx-btn--primary" @click="submit">添加</button>
    </div>

    <ul :class="$style.list">
      <li
        v-for="task in store.tasks"
        :key="task.id"
        :class="$style.item"
        :data-done="task.done ? 'true' : 'false'"
      >
        <button
          type="button"
          :class="$style.check"
          :aria-label="task.done ? '标记未完成' : '标记完成'"
          @click="store.toggle(task.id)"
        >
          <MxIcon v-if="task.done" name="lucide:check" :size="16" />
        </button>
        <span :class="$style.itemTitle">{{ task.title }}</span>
        <button
          type="button"
          class="mx-icon-btn"
          aria-label="删除任务"
          @click="store.remove(task.id)"
        >
          <MxIcon name="lucide:trash-2" :size="16" />
        </button>
      </li>
    </ul>

    <p :class="$style.count">共 {{ store.tasks.length }} 项，完成 {{ store.doneCount }} 项</p>
  </div>
</template>

<style module>
.page {
  padding: var(--mx-space-6);
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-4);
}

.title {
  font: var(--mx-font-title);
  color: var(--mx-text);
  margin: 0;
}

.caption {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  margin: 0;
}

.composer {
  display: flex;
  gap: var(--mx-space-2);
}

.composer .mx-input {
  flex: 1;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.item {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-1) var(--mx-space-2);
  border-radius: var(--mx-radius-control);
}

.item[data-done='true'] .itemTitle {
  color: var(--mx-text-tertiary);
  text-decoration: line-through;
}

.check {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  color: var(--mx-text-on-accent);
  background: transparent;
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-control);
  cursor: pointer;
  transition:
    background-color var(--mx-duration-fast) var(--mx-ease-standard),
    border-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.check:hover {
  border-color: color-mix(in srgb, var(--mx-text) 30%, transparent);
}

.check:active {
  background: var(--mx-active);
}

.check:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--mx-accent) 60%, transparent);
  outline-offset: 1px;
}

.check:disabled {
  opacity: 0.4;
  cursor: default;
}

.item[data-done='true'] .check {
  background: var(--mx-accent);
  border-color: var(--mx-accent);
}

.itemTitle {
  flex: 1;
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.count {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  margin: 0;
}
</style>
