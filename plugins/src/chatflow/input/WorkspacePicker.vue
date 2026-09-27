<script setup lang="ts">
/**
 * WorkspacePicker —— hero 态工作区选择 chip（用户定稿交互，参考 Trae 形态）：
 * 输入卡上方 chip（folder + 目录名 + chevron），下拉列历史工作区（当前项勾选）
 * 与「添加工作区…」（走 fs.choose_dir 弹系统级目录选择对话框）。
 * 选中/添加上抛宿主执行（store.openLatestByDir / chooseWorkspace），本组件纯展示。
 * 取色受军规 14 约束：中性 token，当前项用前景加深 + 字重表达，禁 accent。
 */
import { computed } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'

const props = defineProps<{
  /** 历史工作区（去重目录，最近使用保序；store.workspaces） */
  workspaces: string[]
  /** 当前落点目录（空 = 未选择，触发器显示「选择工作区」） */
  currentDir: string
}>()

const emit = defineEmits<{
  /** 选中历史工作区（宿主 openLatestByDir：有会话切最近会话，无会话记住目录） */
  (e: 'select', dir: string): void
  /** 添加工作区（宿主 chooseWorkspace：系统目录对话框 + openLatestByDir） */
  (e: 'add'): void
}>()

/** 目录展示名（路径末段；根目录回落自身） */
function dirLabel(dir: string): string {
  const parts = dir.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || dir
}

const triggerLabel = computed(() => (props.currentDir ? dirLabel(props.currentDir) : '选择工作区'))

function handleCommand(command: string | number | object): void {
  if (command === '__add__') {
    emit('add')
    return
  }
  const dir = String(command)
  if (dir && dir !== props.currentDir) emit('select', dir)
}
</script>

<template>
  <el-dropdown
    trigger="click"
    popper-class="chatflow-workspace-menu"
    class="workspace-picker"
    @command="handleCommand"
  >
    <button type="button" class="workspace-chip" :title="currentDir || '选择新会话的工作区目录'">
      <MxIcon name="lucide:folder" :size="16" class="chip-icon" />
      <span class="chip-label">{{ triggerLabel }}</span>
      <MxIcon name="lucide:chevron-down" :size="16" class="chip-arrow" />
    </button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item
          v-for="dir in workspaces"
          :key="dir"
          :command="dir"
          :disabled="dir === currentDir"
          :title="dir"
        >
          <MxIcon name="lucide:folder" :size="16" class="item-icon" />
          <span class="item-label">{{ dirLabel(dir) }}</span>
          <MxIcon
            v-if="dir === currentDir"
            name="lucide:check"
            :size="16"
            class="item-check"
          />
        </el-dropdown-item>
        <el-dropdown-item v-if="workspaces.length" divided command="__add__">
          <MxIcon name="lucide:plus" :size="16" class="item-icon" />
          <span class="item-label">添加工作区…</span>
        </el-dropdown-item>
        <el-dropdown-item v-else command="__add__">
          <MxIcon name="lucide:plus" :size="16" class="item-icon" />
          <span class="item-label">添加工作区…</span>
        </el-dropdown-item>
        <el-dropdown-item v-if="!workspaces.length" disabled>
          <span class="item-hint">还没有历史工作区</span>
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<!-- 触发器样式（scoped）；popper 渲染到 body 需全局作用域 -->
<style scoped>
.workspace-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-2);
  max-width: 240px;
  padding: var(--mx-space-1) var(--mx-space-3);
  border: 1px solid color-mix(in srgb, var(--mx-separator) 60%, transparent);
  border-radius: var(--mx-radius-control);
  background: color-mix(in srgb, var(--mx-bg-window) 80%, transparent);
  color: var(--mx-text-secondary);
  font: var(--mx-font-caption);
  cursor: pointer;
  transition: all 0.2s ease;
}

.workspace-chip:hover {
  border-color: color-mix(in srgb, var(--mx-text) 25%, transparent);
  background: color-mix(in srgb, var(--mx-text) 6%, transparent);
  color: var(--mx-text);
}

.chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-icon,
.chip-arrow {
  flex-shrink: 0;
  color: var(--mx-text-tertiary);
}
</style>

<!-- 下拉面板（全局，popper 渲染到 body；全 --mx-* token，军规 14 中性） -->
<style>
.el-dropdown__popper.chatflow-workspace-menu {
  background: var(--mx-bg-elevated);
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-card);
  box-shadow: var(--mx-shadow-prominent);
  padding: var(--mx-space-2);
}

.el-dropdown__popper.chatflow-workspace-menu .el-popper__arrow::before {
  background: var(--mx-bg-elevated);
  border-color: var(--mx-separator);
}

.el-dropdown__popper.chatflow-workspace-menu .el-dropdown-menu {
  background: transparent;
  padding: 0;
}

.chatflow-workspace-menu .el-dropdown-menu__item {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-2) var(--mx-space-3);
  border-radius: var(--mx-radius-control);
  color: var(--mx-text);
  font: var(--mx-font-caption);
}

.chatflow-workspace-menu .el-dropdown-menu__item:not(.is-disabled):hover,
.chatflow-workspace-menu .el-dropdown-menu__item:not(.is-disabled):focus {
  background: color-mix(in srgb, var(--mx-text) 5%, transparent);
  color: var(--mx-text);
}

.chatflow-workspace-menu .el-dropdown-menu__item.is-disabled {
  color: var(--mx-text-secondary);
  font-weight: 600;
  cursor: default;
}

.chatflow-workspace-menu .item-icon {
  color: var(--mx-text-tertiary);
  flex-shrink: 0;
}

.chatflow-workspace-menu .item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chatflow-workspace-menu .item-check {
  color: var(--mx-text-secondary);
  flex-shrink: 0;
}

.chatflow-workspace-menu .item-hint {
  font: var(--mx-font-micro);
  color: var(--mx-text-tertiary);
}
</style>
