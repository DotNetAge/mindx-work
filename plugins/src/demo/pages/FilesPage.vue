<script setup lang="ts">
/** 文件页：纯展示假数据，验证 Content 多条目切换 */
const files = [
  { name: '壳装配说明.md', size: '12 KB', time: '今天 14:02' },
  { name: '设计定稿.pdf', size: '3.1 MB', time: '今天 11:40' },
  { name: '演示数据.json', size: '48 KB', time: '昨天 18:25' },
  { name: '归档.zip', size: '104 MB', time: '9 月 22 日' },
]
</script>

<template>
  <div :class="$style.page">
    <h1 :class="$style.title">文件</h1>
    <p :class="$style.caption">假数据仅用于验证 Content 多条目切换。</p>

    <div :class="$style.table">
      <div :class="[$style.row, $style.head]">
        <span :class="$style.name">名称</span>
        <span>大小</span>
        <span>修改时间</span>
      </div>
      <div v-for="file in files" :key="file.name" :class="$style.row">
        <span :class="$style.name">{{ file.name }}</span>
        <span>{{ file.size }}</span>
        <span>{{ file.time }}</span>
      </div>
    </div>
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

.table {
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-card);
  overflow: hidden;
}

.row {
  display: grid;
  grid-template-columns: 1fr 80px 110px;
  gap: var(--mx-space-3);
  padding: var(--mx-space-2) var(--mx-space-3);
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.row + .row {
  border-top: 1px solid var(--mx-separator);
}

.head {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  background: var(--mx-bg-surface);
}

.row:not(.head):hover {
  background: var(--mx-hover);
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
