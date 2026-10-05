<script setup lang="ts">
/**
 * 团队编辑对话框（一等 Team 实体管理，创建与编辑共用 team.update）。
 * 由 store.teamEditor 驱动（TeamsRecruitRow 新建/编辑、AgentsManagerRow「管理团队」
 * 共用入口），Teleport 到 body 自绘浮层（原组队对话框形态平移，写 Agent frontmatter
 * 的旧语义已废弃）。
 *
 * 挂载纪律：本组件只在 AgentsManagerRow 渲染一次（agents 设置页常驻行）；其他行
 * 经 store.openTeamEditor 打开即可，避免同页多行重复挂载导致双浮层。
 *
 * 字段：名称（编辑态只读，team.update 以此定位）/ 昵称 / 负责人（已招募 Agent 下拉，
 * 必填）/ 成员多选（已招募 Agent，负责人除外）/ 描述 / Profile 文本域。编辑态保存
 * 时把 team.get 回填的 icon/category 原值一并带上（指针语义：不传保持不变，本对话框
 * 不提供这两项编辑，带原值防误清空）；昵称/描述/Profile 空串即清空（所见即所得）。
 */
import { computed, ref, watch } from 'vue'
import { useShell } from '@mindx-work/ui-shell-vue'
import { useAgentsStore, agentDisplayName } from '../store'
import { pushNotice } from '../notice'
import { MODAL_AGENTS_CONFIRM } from '../ids'
import ConfirmModal from '../overlays/ConfirmModal.vue'
import type { Component } from 'vue'
import type { TeamMeta } from '../types'

const store = useAgentsStore()
const shell = useShell()

const open = computed(() => !!store.teamEditor)
const isEdit = computed(() => store.teamEditor?.mode === 'edit')

/** 草稿态（编辑时 team.get 回填；icon/category 仅编辑态原值透传） */
const draftName = ref('')
const draftNick = ref('')
const draftLeader = ref('')
const draftMembers = ref<string[]>([])
const draftDesc = ref('')
const draftProfile = ref('')
const draftIcon = ref('')
const draftCategory = ref('')
const detailLoading = ref(false)
const saving = ref(false)
/** 请求序号：快速开合时丢弃过期响应 */
let reqSeq = 0

watch(
  () => store.teamEditor,
  (ed) => {
    const seq = ++reqSeq
    draftName.value = ed?.mode === 'edit' ? ed.name || '' : ''
    draftNick.value = ''
    draftLeader.value = ''
    draftMembers.value = []
    draftDesc.value = ''
    draftProfile.value = ''
    draftIcon.value = ''
    draftCategory.value = ''
    if (ed?.mode === 'edit' && ed.name) {
      detailLoading.value = true
      store
        .loadTeamDetail(ed.name)
        .then((t: TeamMeta) => {
          if (seq !== reqSeq || store.teamEditor?.name !== ed.name) return
          draftNick.value = t.nick_name || ''
          draftLeader.value = t.leader || ''
          draftMembers.value = [...(t.members || [])]
          draftDesc.value = t.description || ''
          draftProfile.value = t.profile || ''
          draftIcon.value = t.icon || ''
          draftCategory.value = t.category || ''
        })
        .catch((err: unknown) => {
          if (seq === reqSeq) {
            pushNotice(shell, 'error', err instanceof Error ? err.message : '加载团队详情失败')
            store.closeTeamEditor()
          }
        })
        .finally(() => {
          if (seq === reqSeq) detailLoading.value = false
        })
    }
  },
)

/** 负责人下拉源：已招募 Agent（昵称主名显示，悬空 leader 保留原名可选） */
const leaderOptions = computed(() => {
  const list = store.hiredAgents.map((a) => ({ name: a.name, label: agentDisplayName(a) }))
  if (draftLeader.value && !list.some((a) => a.name === draftLeader.value)) {
    list.unshift({ name: draftLeader.value, label: draftLeader.value })
  }
  return list
})

/** 成员多选源：已招募 Agent 排除负责人（负责人由独立字段表达） */
const memberOptions = computed(() => store.hiredAgents.filter((a) => a.name !== draftLeader.value))

function onLeaderChange(): void {
  // 负责人变更后把原负责人从成员草稿中移出（成员清单不含负责人）
  draftMembers.value = draftMembers.value.filter((m) => m !== draftLeader.value)
}

/** modal 互斥惯例：add 前先 remove 同 id（契约 §6）；删除走壳 ConfirmModal */
function openConfirm(): void {
  if (shell.Overlay.has(MODAL_AGENTS_CONFIRM)) shell.Overlay.remove(MODAL_AGENTS_CONFIRM)
  shell.Overlay.add({ id: MODAL_AGENTS_CONFIRM, kind: 'modal', component: ConfirmModal as Component })
}

/** 删除团队（仅编辑态；先硬关本浮层再开 modal——壳 modal z 序低于 Teleport 浮层） */
function requestDelete(): void {
  const name = draftName.value.trim()
  if (!name) return
  store.closeTeamEditor()
  store.requestConfirm(
    '删除团队',
    `确定删除团队「${name}」吗？团队配置将被移除，不可恢复。`,
    '删除',
    `已删除团队「${name}」`,
    async () => {
      await store.deleteTeam(name)
    },
  )
  openConfirm()
}

async function save(): Promise<void> {
  const name = draftName.value.trim()
  if (!name) {
    pushNotice(shell, 'error', '团队名不能为空')
    return
  }
  if (!draftLeader.value) {
    pushNotice(shell, 'error', '请选择负责人')
    return
  }
  saving.value = true
  try {
    await store.updateTeam({
      name,
      nick_name: draftNick.value.trim(),
      leader: draftLeader.value,
      members: [...new Set(draftMembers.value)],
      description: draftDesc.value.trim(),
      profile: draftProfile.value,
      // 本对话框不编辑 icon/category：编辑态带 team.get 原值（指针语义防误清空），新建不传
      ...(isEdit.value ? { icon: draftIcon.value, category: draftCategory.value } : {}),
    })
    await store.refreshTeams()
    store.closeTeamEditor()
    const saved = draftNick.value.trim() || name
    pushNotice(shell, 'success', isEdit.value ? `团队「${saved}」已保存` : `团队「${name}」已创建`)
  } catch (err: unknown) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '团队保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" :class="$style.mask" @click.self="store.closeTeamEditor()">
      <div :class="$style.modal">
        <h3 :class="$style.title">{{ isEdit ? '编辑团队' : '新建团队' }}</h3>

        <p v-if="detailLoading" class="mx-text-loading" :class="$style.loading">正在加载团队详情…</p>

        <template v-else>
          <label :class="$style.field">
            <span :class="$style.label">团队名</span>
            <input
              v-model="draftName"
              class="mx-input"
              :disabled="isEdit"
              placeholder="团队唯一标识"
              :title="isEdit ? '团队名不可修改' : undefined"
            />
          </label>

          <label :class="$style.field">
            <span :class="$style.label">昵称</span>
            <input v-model="draftNick" class="mx-input" placeholder="展示用外号，留空显示团队名" />
          </label>

          <label :class="$style.field">
            <span :class="$style.label">负责人</span>
            <el-select
              v-model="draftLeader"
              class="team-editor-select"
              teleported
              popper-class="team-editor-popper"
              placeholder="选择已招募的智能体"
              @change="onLeaderChange"
            >
              <el-option v-for="opt in leaderOptions" :key="opt.name" :label="opt.label" :value="opt.name" />
            </el-select>
          </label>

          <label :class="$style.field">
            <span :class="$style.label">成员</span>
            <el-select
              v-model="draftMembers"
              class="team-editor-select"
              teleported
              popper-class="team-editor-popper"
              multiple
              collapse-tags
              collapse-tags-tooltip
              placeholder="选择已招募的智能体（可多选）"
            >
              <el-option v-for="a in memberOptions" :key="a.name" :label="agentDisplayName(a)" :value="a.name" />
            </el-select>
          </label>

          <label :class="$style.field">
            <span :class="$style.label">描述</span>
            <input v-model="draftDesc" class="mx-input" placeholder="一句话介绍这个团队" />
          </label>

          <label :class="$style.field">
            <span :class="$style.label">团队职责</span>
            <textarea
              v-model="draftProfile"
              :class="$style.profile"
              rows="5"
              placeholder="团队职责说明（Profile），暂无内容"
            ></textarea>
          </label>
        </template>

        <div :class="$style.foot">
          <button v-if="isEdit" type="button" class="mx-btn" :class="$style.deleteBtn" :disabled="saving" @click="requestDelete">
            删除团队
          </button>
          <div :class="$style.footActions">
            <button type="button" class="mx-btn" @click="store.closeTeamEditor()">取消</button>
            <button type="button" class="mx-btn mx-btn--primary" :disabled="detailLoading || saving" @click="save">
              <span v-if="saving" class="mx-text-loading">保存中…</span>
              <template v-else>保存</template>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style module>
/* Teleport 自包含浮层（壳 modal z 序 60 之下席位，本浮层 70——沿用原组队对话框层级） */
.mask {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mx-mask);
}

.modal {
  width: 460px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
  padding: var(--mx-space-4);
  border-radius: var(--mx-radius-window);
  background: var(--mx-bg-elevated);
  border: 1px solid var(--mx-separator);
  box-shadow: var(--mx-shadow-panel);
}

.title {
  margin: 0;
  font: var(--mx-font-heading);
  font-weight: 600;
  color: var(--mx-text);
}

.loading {
  margin: 0;
  padding: var(--mx-space-4) 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.label {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

/* Profile 文本域（对齐 AgentsManagerRow .area 几何） */
.profile {
  box-sizing: border-box;
  width: 100%;
  min-height: 96px;
  resize: vertical;
  padding: 8px 10px;
  background: var(--mx-module);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-control);
  font: var(--mx-font-body);
  line-height: 1.6;
  color: var(--mx-text);
  transition: border-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.profile::placeholder {
  color: var(--mx-text-tertiary);
}

.profile:focus {
  outline: none;
  border-color: var(--mx-accent);
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
}

.footActions {
  display: flex;
  gap: var(--mx-space-2);
  margin-left: auto;
}

.deleteBtn {
  color: var(--mx-state-warn-label);
}
</style>

<style>
/* el-select popper（teleport 到 body）主题适配：仿 calendar-popper 全局定制 */
.team-editor-popper.el-popper {
  background: var(--mx-menu-bg);
  border: 1px solid var(--mx-separator);
}

.team-editor-popper .el-select-dropdown__item {
  color: var(--mx-text);
}

.team-editor-popper .el-select-dropdown__item.is-hovering {
  background: var(--mx-hover);
}

.team-editor-popper .el-select-dropdown__item.is-selected {
  color: var(--mx-accent);
}

.team-editor-popper .el-select-dropdown__empty {
  color: var(--mx-text-tertiary);
}
</style>
