<script setup lang="ts">
// team 实体卡展开态：成员列表（TeamCreate 参数投影，PR §2.2 族 2）。
// 源：mindx-desktop tree/nodes/team/TeamNodeView.vue（二期 B 平移）。
import type { TeamNode } from '../../types/entity'

defineProps<{ node: TeamNode }>()
</script>

<template>
  <div class="team-detail">
    <div v-if="node.description" class="team-desc">{{ node.description }}</div>
    <div v-if="node.members.length" class="member-list">
      <div v-for="(m, i) in node.members" :key="i" class="member-row">
        <span class="member-name">{{ m.name }}</span>
        <span v-if="m.role" class="member-role">{{ m.role === 'leader' ? '负责人' : m.role }}</span>
      </div>
    </div>
    <div v-else class="member-empty">无成员信息</div>
  </div>
</template>

<style scoped>
.team-detail {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  padding: var(--mx-space-1) 0;
}

.team-desc {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.member-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.member-row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  font: var(--mx-font-caption);
}

.member-name {
  color: var(--mx-text-secondary);
}

/* 平铺样式：角色徽标去底色块，改纯文本 */
.member-role {
  font: var(--mx-font-caption);
  color: var(--mx-accent);
}

.member-empty {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}
</style>
