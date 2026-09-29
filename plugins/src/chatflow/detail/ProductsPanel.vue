<script setup lang="ts">
/**
 * Detail「产物」tab（概念框架 §6.1 三段定稿）：会话产物聚合呈现。
 * - 对话产物：本会话 Write 工具写出的 .md 文档（第一版口径；与"最近文件"的
 *   边界是 §9 开放问题，留后调）
 * - 技能：全局技能清单（第一版口径；会话级技能激活记录依赖工作目录级
 *   存储迁移，落地前先呈现可用清单）
 * - 最近文件：本会话 write/edit 工具痕迹 + 待确认变更集合并（最近在前）
 * 数据全部来自 chatflow store 响应式本体与 daemon RPC（skill.list），无新增持久化。
 */
import { computed, onMounted, ref } from 'vue'
import { MxIcon, useService } from '@mindx-work/ui-shell-vue'
import { useChatflowStore } from '../store'

// 跨插件服务形状契约（消费侧仅声明所需形状；契约 §10.2 禁止跨插件 import）
interface DaemonConnectionShape {
  call<T>(method: string, params?: unknown): Promise<T>
}
interface SkillItem {
  name: string
  description?: string
  metadata?: { name_zh?: string; description_zh?: string }
}

const store = useChatflowStore()
const daemon = useService<DaemonConnectionShape>('daemon.connection')

/** 文件行：工具痕迹与待确认变更的统一呈现形状 */
interface FileRow {
  path: string
  additions?: number
  deletions?: number
  isNew?: boolean
  /** 对话产物标记：Write 写出的 .md 文档 */
  isProduct: boolean
}

/** 会话文件痕迹（倒序去重，同文件统计累加）+ 待确认变更集并入 */
const fileRows = computed<FileRow[]>(() => {
  const byPath = new Map<string, FileRow>()
  const msgs = store.activeMessages
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!
    if (m.eventType !== 'tool_exec') continue
    if (m.eventTitle !== 'Write' && m.eventTitle !== 'Edit') continue
    // 执行中/失败的调用不进清单；被拒绝的调用无 start.params，路径判空自然跳过
    if (m.eventData?.status === 'executing' || m.eventData?.status === 'failed') continue
    const params = m.eventData?.start?.params || {}
    const path = String(params.file_path ?? params.filePath ?? '')
    if (!path) continue
    const meta = m.eventData?.end?.result_meta
    const row: FileRow = {
      path,
      additions: Number(meta?.additions) || undefined,
      deletions: Number(meta?.deletions) || undefined,
      isProduct: m.eventTitle === 'Write' && path.endsWith('.md'),
    }
    const prev = byPath.get(path)
    if (!prev) {
      byPath.set(path, row)
    } else {
      prev.additions = (prev.additions || 0) + (row.additions || 0) || undefined
      prev.deletions = (prev.deletions || 0) + (row.deletions || 0) || undefined
    }
  }
  // 待确认变更集并入（确认/回滚后消失）：已有痕迹行的统计以待确认集为准
  const pending = store.pendingFileModificationsBySession[store.activeSessionId] || []
  for (const p of pending) {
    const prev = byPath.get(p.path)
    if (prev) {
      prev.additions = p.additions
      prev.deletions = p.deletions
    } else {
      byPath.set(p.path, {
        path: p.path,
        additions: p.additions,
        deletions: p.deletions,
        isNew: p.isNew,
        isProduct: p.path.endsWith('.md') && p.isNew,
      })
    }
  }
  return [...byPath.values()]
})

/** 对话产物段：Agent 写出的正式文档（第一版 = Write 产生的 .md） */
const products = computed(() => fileRows.value.filter((row) => row.isProduct))

/** 技能段：全局技能清单（首开拉取一次；空态「暂无内容」） */
const skills = ref<SkillItem[]>([])
const skillsLoading = ref(true)

onMounted(async () => {
  try {
    skills.value = await daemon.call<SkillItem[]>('skill.list', {})
  } catch {
    skills.value = []
  } finally {
    skillsLoading.value = false
  }
})

/** 技能展示名：中文名优先（对齐 skills 插件先例，本地实现避免跨插件 import） */
function skillTitle(skill: SkillItem): string {
  const zh = skill.metadata?.name_zh
  return (typeof zh === 'string' && zh.trim()) || skill.name
}

/** 文件行点击：走 chatflow 文件路由（md→文档查看器、图片→看图器、其余→编辑器） */
function openFile(path: string): void {
  void store.openFile(path)
}

/** 行内只显示文件名，完整路径放 title（悬停可见） */
function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}
</script>

<template>
  <div :class="$style.panel">
    <!-- 对话产物段 -->
    <section :class="$style.section">
      <h3 :class="$style.sectionTitle">对话产物</h3>
      <p v-if="products.length === 0" :class="$style.empty">暂无内容</p>
      <button
        v-for="row in products"
        :key="`p-${row.path}`"
        type="button"
        :class="$style.row"
        :title="row.path"
        @click="openFile(row.path)"
      >
        <MxIcon name="lucide:file-text" :size="16" />
        <span :class="$style.rowName">{{ basename(row.path) }}</span>
        <span v-if="row.additions" :class="$style.add">+{{ row.additions }}</span>
        <span v-if="row.deletions" :class="$style.del">-{{ row.deletions }}</span>
      </button>
    </section>

    <!-- 技能段 -->
    <section :class="$style.section">
      <h3 :class="$style.sectionTitle">技能</h3>
      <p v-if="skillsLoading" :class="$style.empty">加载中…</p>
      <p v-else-if="skills.length === 0" :class="$style.empty">暂无内容</p>
      <div v-for="skill in skills" :key="skill.name" :class="$style.row">
        <MxIcon name="lucide:sparkles" :size="16" />
        <span :class="$style.rowName">{{ skillTitle(skill) }}</span>
      </div>
    </section>

    <!-- 最近文件段 -->
    <section :class="$style.section">
      <h3 :class="$style.sectionTitle">最近文件</h3>
      <p v-if="fileRows.length === 0" :class="$style.empty">暂无内容</p>
      <button
        v-for="row in fileRows"
        :key="`f-${row.path}`"
        type="button"
        :class="$style.row"
        :title="row.path"
        @click="openFile(row.path)"
      >
        <MxIcon :name="row.isNew ? 'lucide:file-plus-2' : 'lucide:file-pen'" :size="16" />
        <span :class="$style.rowName">{{ basename(row.path) }}</span>
        <span v-if="row.additions" :class="$style.add">+{{ row.additions }}</span>
        <span v-if="row.deletions" :class="$style.del">-{{ row.deletions }}</span>
      </button>
    </section>
  </div>
</template>

<style module>
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
}

/* 分组分隔线：非首段标题上方一根软线（段间视觉分区） */
.section + .section {
  border-top: 1px solid var(--mx-separator-soft);
  padding-top: var(--mx-space-3);
}

.sectionTitle {
  margin: 0 0 var(--mx-space-2);
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.empty {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  width: 100%;
  padding: var(--mx-space-1) var(--mx-space-2);
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  color: var(--mx-text);
  font: var(--mx-font-body);
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
}

/* 技能行非交互（只读清单），div 形态去指针样式 */
div.row {
  cursor: default;
}

button.row:hover {
  background: var(--mx-hover);
}

.row:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

.rowName {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.add {
  color: var(--mx-success);
  font: var(--mx-font-caption);
}

.del {
  color: var(--mx-danger);
  font: var(--mx-font-caption);
}
</style>
