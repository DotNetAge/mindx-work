<script setup lang="ts">
/**
 * Sidebar「仪表板」节：当前工作区 .agents/dashboards/ 的仪表板清单（store.boardList，
 * 随工作目录变化与 Agent 工具事件自动刷新）。行 = <board name> 仪表板名
 * （缺失回退文件名，tooltip 恒显文件名），点击打开到 Detail 轨道；
 * 当前打开的仪表板行灰底高亮（data-active，对齐壳行语义）。
 * 无仪表板时整节不渲染（标题/空态/折叠钮均隐藏）——仅在存在仪表板时出现。
 * 折叠 rail = 36px 图标钮（点击刷新清单）。行几何对齐壳 SidebarPane 行
 * （34px / radius 8）。
 */
import { onMounted } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useKanbanStore } from './store'

const props = defineProps<{ compact?: boolean }>()

const store = useKanbanStore()

// 挂载补一次清单（store 内 watch 已随连接/工作目录拉取，此处为晚挂载兜底）
onMounted(() => {
  void store.refreshList()
})

function refresh(): void {
  void store.refreshList()
}
</script>

<template>
  <!-- 折叠 rail：36px 图标钮（对齐壳折叠行节奏）；无仪表板不显示 -->
  <button v-if="props.compact && store.boardList.length > 0" type="button" :class="$style.railBtn" title="刷新仪表板清单" @click="refresh">
    <MxIcon name="lucide:layout-dashboard" :size="20" />
  </button>

  <div v-else-if="store.boardList.length > 0" :class="$style.root">
    <div :class="$style.groupHeader">
      <span :class="$style.groupTitle">仪表板</span>
    </div>

    <div
      v-for="b in store.boardList"
      :key="b.path"
      :class="$style.row"
      :data-active="store.currentFile === b.path ? 'true' : 'false'"
    >
      <button type="button" :class="$style.rowMain" @click="store.open(b.path)">
        <MxIcon name="lucide:layout-dashboard" :size="16" :class="$style.rowIcon" />
        <el-tooltip :content="b.name" placement="right" :show-after="500" :offset="8">
          <span :class="$style.rowName">{{ b.title }}</span>
        </el-tooltip>
      </button>
    </div>
  </div>
</template>

<style module>
.root {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 2px var(--mx-space-1);
}

.groupHeader {
  display: flex;
  align-items: center;
  height: 24px;
  padding: 0 var(--mx-space-1) 0 4px;
  flex-shrink: 0;
}

.groupTitle {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

/* ── 仪表板行（几何对齐壳行：34 高 / radius 8 / padding 0 8）── */
.row {
  display: flex;
  align-items: center;
  width: 100%;
  height: 34px;
  padding: 0 var(--mx-space-2);
  box-sizing: border-box;
  flex-shrink: 0;
  border-radius: var(--mx-radius-control);
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.row:hover:not([data-active='true']) {
  background: var(--mx-hover);
}

.row:active:not([data-active='true']) {
  background: var(--mx-active);
}

.row:focus-within {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

/* 选中态（状态而非交互态）：灰底，对齐壳行 data-active 语义 */
.row[data-active='true'] {
  background: var(--mx-hover);
}

.rowMain {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  padding: 0;
  font: var(--mx-font-body);
  color: var(--mx-text);
  background: transparent;
  border: none;
  border-radius: var(--mx-radius-control);
  cursor: pointer;
  text-align: left;
}

.rowIcon {
  flex-shrink: 0;
  color: var(--mx-text-tertiary);
}

.rowName {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── 折叠 rail：36px 图标钮（对齐壳折叠行几何）── */
.railBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: var(--mx-radius-card);
  background: transparent;
  color: var(--mx-text);
  cursor: pointer;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.railBtn:hover {
  background: var(--mx-hover);
}

.railBtn:active {
  background: var(--mx-active);
}

.railBtn:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}
</style>
