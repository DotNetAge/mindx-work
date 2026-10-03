<script setup lang="ts">
/**
 * Sidebar「仪表板」节：当前工作区 .agents/dashboards/ 的仪表板清单（store.boardList，
 * 随工作目录变化与 Agent 工具事件自动刷新）。行 = <board name> 仪表板名
 * （缺失回退文件名，tooltip 恒显文件名），点击打开到 Detail 轨道；
 * 当前打开的仪表板行灰底高亮（data-active，对齐壳行语义）。
 * 无仪表板时整节不渲染（标题/空态/折叠钮均隐藏）——仅在存在仪表板时出现。
 * 分组头可点击折叠/展开（内存态，chevron 右缘，对齐 Tasks 分组头形态）。
 * 折叠 rail = 36px 图标钮（点击刷新清单）。行几何对齐壳 SidebarPane 行
 * （34px / radius 8）。
 */
import { onMounted, ref } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useDashboardStore } from './store'

const props = defineProps<{ compact?: boolean }>()

const store = useDashboardStore()

// ── 分组折叠：分组头可点击折叠/展开（内存态，不持久化）──
const collapsed = ref(false)

function toggleCollapsed(): void {
  collapsed.value = !collapsed.value
}

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
    <button
      type="button"
      :class="$style.groupHeader"
      :aria-expanded="collapsed ? 'false' : 'true'"
      @click="toggleCollapsed"
    >
      <span :class="$style.groupTitle">仪表板</span>
      <MxIcon
        name="lucide:chevron-down"
        :size="16"
        :class="[$style.groupChevron, { [$style.groupChevronCollapsed]: collapsed }]"
      />
    </button>
    <!-- grid 0fr→1fr 行高过渡：折叠平滑收拢（对齐壳 footer 折叠技巧） -->
    <div :class="$style.groupBody" :data-collapsed="collapsed ? 'true' : 'false'">
      <div :class="$style.groupClip">
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
  /* Sidebar 出现滚动时不显示滚动条（滚轮/触控板滚动能力保留） */
  scrollbar-width: none;
  padding: 0 2px var(--mx-space-1);
}

.root::-webkit-scrollbar {
  display: none;
}

/* ── 分组头（button：整行可点击折叠/展开，标题左 / chevron 右）──
   用户定稿（2026-10-03 截图批注）：分组头无背景、字体统一小字（caption）、
   上下留白增大、右侧折叠指示默认隐藏 hover 才显现 */
.groupHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  margin: var(--mx-space-2) 0 var(--mx-space-1);
  padding: 0 var(--mx-space-1) 0 4px;
  flex-shrink: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
}

.groupHeader:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

.groupTitle {
  flex: 0 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 折叠指示：靠行右缘，默认隐藏、hover 分组头才显现；折叠转 -90°（朝右），展开朝下 */
.groupChevron {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--mx-text-tertiary);
  opacity: 0;
  transition: transform var(--mx-duration-fast) var(--mx-ease-standard),
    opacity var(--mx-duration-fast) var(--mx-ease-standard);
}

.groupHeader:hover .groupChevron,
.groupHeader:focus-visible .groupChevron {
  opacity: 1;
}

.groupChevronCollapsed {
  transform: rotate(-90deg);
}

/* 折叠体：grid 0fr→1fr 行高过渡（内容随行高收拢，展开/收起平滑） */
.groupBody {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows var(--mx-duration-motion) var(--mx-ease-standard);
}

.groupBody[data-collapsed='true'] {
  grid-template-rows: 0fr;
}

/* 裁切层：min-height 0 允许行高压到 0；visibility 过渡保证折叠后焦点不可达 */
.groupClip {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 2px;
  visibility: visible;
  transition: visibility var(--mx-duration-motion) var(--mx-ease-standard);
}

.groupBody[data-collapsed='true'] .groupClip {
  visibility: hidden;
}

@media (prefers-reduced-motion: reduce) {
  .groupChevron,
  .groupBody,
  .groupClip {
    transition: none;
  }
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
