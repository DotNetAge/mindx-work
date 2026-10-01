<script setup lang="ts">
/**
 * Detail「产物」tab（概念框架 §6.1 三段定稿）：会话产物聚合呈现。
 * - 对话产物：本会话 Write 工具写出的 .md 文档（第一版口径；与"最近文件"的
 *   边界是 §9 开放问题，留后调）
 * - 技能：当前项目 .agents/skills 发现式清单（点击打开 SKILL.md 正文；
 *   行尾菜单支持晋升全局技能库 / 删除）
 * - 待办：工作目录 TODO.md 的 ToDo List（TodoPanel，增删改）
 * - 最近文件：本会话 write/edit 工具痕迹 + 待确认变更集合并（最近在前）
 * 数据全部来自 chatflow store 响应式本体与 daemon RPC，无新增持久化。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MxIcon, useService } from '@mindx-work/ui-shell-vue'
import { useChatflowStore } from '../store'
import TodoPanel from './TodoPanel.vue'

// 跨插件服务形状契约（消费侧仅声明所需形状；契约 §10.2 禁止跨插件 import）
interface DaemonConnectionShape {
  call<T>(method: string, params?: unknown): Promise<T>
}

/** 项目级技能条目（skill.list 带 project_dir 的精简投影；不含指令正文） */
interface ProjectSkill {
  name: string
  description?: string
  root_dir?: string
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

/** 技能段：当前项目 .agents/skills 发现式清单（跟随工作目录；空态「暂无内容」） */
const skills = ref<ProjectSkill[]>([])
const skillsLoading = ref(true)

async function loadSkills(): Promise<void> {
  if (!store.currentProjectDir) {
    skills.value = []
    skillsLoading.value = false
    return
  }
  skillsLoading.value = true
  try {
    const r = await daemon.call<{ skills: ProjectSkill[] }>('skill.list', {
      project_dir: store.currentProjectDir,
    })
    skills.value = r.skills || []
  } catch {
    skills.value = []
  } finally {
    skillsLoading.value = false
  }
}

// 工作目录随会话切换 → 重拉清单（目录可能晚于挂载就绪，immediate 兜底首拉）
watch(() => store.currentProjectDir, loadSkills, { immediate: true })

/** 点击技能行：打开 SKILL.md 正文（md 路由 Markdown 查看器） */
function openSkill(sk: ProjectSkill): void {
  if (sk.root_dir) void store.openFile(`${sk.root_dir}/SKILL.md`)
}

/** 安装至技能库：项目级晋升全局库（纯复制搬运；同名默认拒绝，错误透传） */
async function promoteSkill(sk: ProjectSkill): Promise<void> {
  try {
    await daemon.call('skill.promote', {
      name: sk.name,
      from: 'project',
      to: 'global',
      project_dir: store.currentProjectDir,
    })
    ElMessage.success(`已安装至技能库：${sk.name}`)
  } catch (e) {
    ElMessage.error(`安装失败：${(e as Error).message}`)
  }
}

/** 删除项目技能：移除工作目录内技能目录（不可恢复，先确认） */
async function removeSkill(sk: ProjectSkill): Promise<void> {
  if (!sk.root_dir) return
  try {
    await ElMessageBox.confirm(
      `删除项目技能「${sk.name}」？其目录将从工作目录移除，不可恢复。`,
      '删除技能',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return // 用户取消
  }
  try {
    await daemon.call('fs.rm', { path: sk.root_dir, recurse: true })
    ElMessage.success(`已删除：${sk.name}`)
  } catch (e) {
    ElMessage.error(`删除失败：${(e as Error).message}`)
  }
  await loadSkills()
}

function onSkillMenu(sk: ProjectSkill, command: string): void {
  if (command === 'promote') void promoteSkill(sk)
  else if (command === 'remove') void removeSkill(sk)
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

    <!-- 技能段：项目级发现式清单（点击开正文，行尾菜单晋升/删除） -->
    <section :class="$style.section">
      <h3 :class="$style.sectionTitle">技能</h3>
      <p v-if="skillsLoading" :class="$style.empty">加载中…</p>
      <p v-else-if="skills.length === 0" :class="$style.empty">暂无内容</p>
      <div
        v-for="sk in skills"
        :key="sk.name"
        :class="[$style.row, $style.skillRow]"
        :title="sk.description || sk.name"
        @click="openSkill(sk)"
      >
        <MxIcon name="lucide:sparkles" :size="16" />
        <span :class="$style.rowName">{{ sk.name }}</span>
        <el-dropdown
          trigger="click"
          popper-class="products-skill-menu"
          @command="(c: string) => onSkillMenu(sk, c)"
        >
          <button type="button" :class="$style.rowMenu" title="更多操作" @click.stop>
            <MxIcon name="lucide:ellipsis" :size="16" />
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="promote">安装至技能库</el-dropdown-item>
              <el-dropdown-item command="remove" divided>删除</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
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

    <!-- 待办段：工作目录 TODO.md（增删改，组件内自带分隔线与标题） -->
    <TodoPanel />
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

/* 技能行可点（打开 SKILL.md 正文） */
.skillRow {
  cursor: pointer;
}

.skillRow:hover {
  background: var(--mx-hover);
}

/* 行尾「更多」菜单按钮：ghost 图标（点击不触发行点击） */
.rowMenu {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  color: var(--mx-text-tertiary);
  cursor: pointer;
  outline: none;
}

.rowMenu:hover,
.rowMenu:focus-visible {
  background: var(--mx-hover);
  color: var(--mx-text);
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

<!-- 技能菜单 popper（渲染到 body，全局作用域；对齐 WorkspacePicker 先例，全 --mx-* token） -->
<style>
.el-dropdown__popper.products-skill-menu {
  background: var(--mx-bg-elevated);
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-card);
  box-shadow: var(--mx-shadow-prominent);
  padding: var(--mx-space-2);
}

.el-dropdown__popper.products-skill-menu .el-popper__arrow::before {
  background: var(--mx-bg-elevated);
  border-color: var(--mx-separator);
}

.el-dropdown__popper.products-skill-menu .el-dropdown-menu {
  background: transparent;
  padding: 0;
}

.products-skill-menu .el-dropdown-menu__item {
  display: flex;
  align-items: center;
  padding: var(--mx-space-2) var(--mx-space-3);
  border-radius: var(--mx-radius-control);
  color: var(--mx-text);
  font: var(--mx-font-caption);
  white-space: nowrap;
}

.products-skill-menu .el-dropdown-menu__item:not(.is-disabled):hover,
.products-skill-menu .el-dropdown-menu__item:not(.is-disabled):focus {
  background: color-mix(in srgb, var(--mx-text) 5%, transparent);
  color: var(--mx-text);
}
</style>
