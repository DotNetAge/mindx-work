<script setup lang="ts">
/**
 * PermissionBar：授权阻塞交互卡（吸底 Drawer 内渲染，desktop PermissionBar.vue 平移）。
 *
 * 纯 props/emit 组件：授权决策经 grant/deny 事件上抛宿主（useBlockers → store
 * grantPermission/denyPermission 发魔术词），组件自身不触碰 RPC。
 * - sessionId：子会话授权冒泡时携带发起授权的子会话 ID，宿主据此路由魔术词；
 * - disabled：授权已被后端撤销（permission_denied），整体灰化并禁用全部交互。
 * 文案取 desktop i18n zh 权威值（中文字面量）；图标 MxIcon（军规 9）。
 */
import { ref, computed } from 'vue'

const props = defineProps({
  toolName: {
    type: String,
    default: ''
  },
  reason: {
    type: String,
    default: ''
  },
  securityLevel: {
    type: String,
    default: 'medium'
  },
  // 子会话授权冒泡：发起授权的子会话 ID，授权/拒绝决策据此发送带目标魔法词
  sessionId: {
    type: String,
    default: ''
  },
  // 授权已被后端撤销（收到 permission_denied）：禁用全部交互并整体灰化
  disabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['grant', 'deny'])

const isExpanded = ref(true)
const submitted = ref(false)
const isSubmitting = ref(false)
const remember = ref(false)

interface LevelStyle {
  color: string
  bg: string
  border: string
  icon: string
  label: string
}

/** 缺省档（未知级别回落中等风险） */
const LEVEL_MEDIUM: LevelStyle = {
  color: 'var(--mx-warning)',
  bg: 'color-mix(in srgb, var(--mx-warning) 10%, transparent)',
  border: 'color-mix(in srgb, var(--mx-warning) 30%, transparent)',
  icon: '🟡',
  label: '中等风险'
}

const levelConfig = computed<LevelStyle>(() => {
  const configs: Record<string, LevelStyle> = {
    low: {
      color: 'var(--mx-success)',
      bg: 'color-mix(in srgb, var(--mx-success) 10%, transparent)',
      border: 'color-mix(in srgb, var(--mx-success) 30%, transparent)',
      icon: '🟢',
      label: '低风险'
    },
    medium: LEVEL_MEDIUM,
    high: {
      color: 'var(--mx-danger)',
      bg: 'color-mix(in srgb, var(--mx-danger) 10%, transparent)',
      border: 'color-mix(in srgb, var(--mx-danger) 30%, transparent)',
      icon: '🔴',
      label: '高风险'
    }
  }
  return configs[props.securityLevel] ?? LEVEL_MEDIUM
})

function handleGrant() {
  // 已撤销的授权不再接受任何决策，防止过期卡片误发魔术词
  if (isSubmitting.value || props.disabled) return
  isSubmitting.value = true
  submitted.value = true
  isExpanded.value = false
  // 携带 tool_name：授权决策由弹窗自身数据提供，不依赖全局 pendingPermissionToolName
  // 携带 session_id：子会话授权时发送带目标魔法词，后端精确路由到挂起子会话
  const payload = { tool_name: props.toolName, remember: remember.value, session_id: props.sessionId }
  emit('grant', payload)
}

function handleDeny() {
  // 已撤销的授权不再接受任何决策，防止过期卡片误发魔术词
  if (isSubmitting.value || props.disabled) return
  isSubmitting.value = true
  submitted.value = true
  isExpanded.value = false
  emit('deny', { reason: '用户拒绝', session_id: props.sessionId, tool_name: props.toolName })
}

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}
</script>

<template>
  <div class="permission-bar" :class="[securityLevel, { 'is-revoked': disabled }]">
    <!-- Header（button 键盘可达） -->
    <button type="button" class="perm-header" @click="toggleExpand">
      <div class="header-left">
        <div class="warning-icon" :style="{ background: levelConfig.bg, borderColor: levelConfig.border }">
          <MxIcon name="lucide:layers" :size="18" />
          <span class="level-emoji">{{ levelConfig.icon }}</span>
        </div>

        <div class="title-section">
          <h4 class="perm-title">权限请求</h4>
          <p class="tool-name">{{ toolName }}</p>
        </div>
      </div>

      <div class="header-right">
        <span
          class="level-badge"
          :style="{
            color: levelConfig.color,
            background: levelConfig.bg,
            borderColor: levelConfig.border
          }"
        >
          {{ levelConfig.label }}
        </span>

        <MxIcon
          class="expand-icon"
          :name="isExpanded ? 'lucide:chevron-down' : 'lucide:chevron-right'"
          :size="16"
        />
      </div>
    </button>

    <!-- Body -->
    <transition name="expand">
      <div class="perm-body" v-show="isExpanded">
        <!-- Reason -->
        <div class="reason-block" v-if="reason">
          <div class="reason-label">📋 执行原因</div>
          <p class="reason-text">{{ reason }}</p>
        </div>

        <!-- 记住授权 -->
        <label class="remember-option">
          <input type="checkbox" v-model="remember" :disabled="isSubmitting || disabled" />
          <span class="remember-label">本次会话记住此授权</span>
        </label>

        <!-- Action Buttons -->
        <div class="action-buttons">
          <button class="deny-btn" type="button" @click="handleDeny" :disabled="isSubmitting || disabled">
            <MxIcon name="lucide:x" :size="16" />
            拒绝执行
          </button>

          <button
            class="grant-btn"
            type="button"
            @click="handleGrant"
            :disabled="isSubmitting || disabled"
            :style="{ background: `linear-gradient(135deg, ${levelConfig.color}, color-mix(in srgb, ${levelConfig.color} 87%, transparent))` }"
          >
            <MxIcon name="lucide:check" :size="16" />
            授权执行
          </button>
        </div>

        <!-- Security Notice -->
        <div class="security-notice" v-if="securityLevel === 'high'">
          ⚠️ 此操作可能影响以下文件和资源
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
/* token 映射（desktop → work，四期映射表留痕）：--bg-card→--mx-bg-elevated、
   --accent-cyan→--mx-accent、--text-primary→--mx-text、--text-muted→--mx-text-tertiary、
   --border-color→--mx-separator、--radius-xl→--mx-radius-card、--radius-lg→--mx-radius-card、
   --radius-md→--mx-radius-control、--space-0→2px、--space-5→--mx-space-6 */
.permission-bar {
  /* Drawer 激活显示时使用不透明背景，避免半透明导致下层消息文字视觉重叠 */
  background: var(--mx-bg-elevated);
  border: 1px solid color-mix(in srgb, var(--mx-accent) 30%, transparent);
  border-radius: var(--mx-radius-card);
  overflow: hidden;
  box-shadow: 0 8px 32px color-mix(in srgb, var(--mx-accent) 8%, transparent);
}

.permission-bar.high {
  border-color: color-mix(in srgb, var(--mx-danger) 40%, transparent);
  background: color-mix(in srgb, var(--mx-bg-elevated) 94%, var(--mx-danger) 6%);
  box-shadow: 0 8px 32px color-mix(in srgb, var(--mx-danger) 8%, transparent);
}

/* 授权已被后端撤销（permission_denied）：整体灰化且不再响应交互 */
.permission-bar.is-revoked {
  opacity: 0.65;
  filter: grayscale(0.85);
  border-color: var(--mx-separator);
  box-shadow: none;
}

.permission-bar.is-revoked .perm-header {
  cursor: default;
}

.permission-bar.is-revoked .perm-header:hover {
  background: transparent;
}

.perm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--mx-space-4) var(--mx-space-5);
  cursor: pointer;
  user-select: none;
  transition: background 0.2s ease;
  gap: var(--mx-space-4);
  background: transparent;
  border: none;
  font: inherit;
  color: inherit;
  text-align: left;
}

.perm-header:hover {
  background: color-mix(in srgb, var(--mx-accent) 4%, transparent);
}

.perm-header:active {
  background: color-mix(in srgb, var(--mx-accent) 8%, transparent);
}

.permission-bar.is-revoked .perm-header:active {
  background: transparent;
}

.perm-header:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: -2px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
  flex: 1;
  min-width: 0;
}

.warning-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--mx-radius-card);
  border: 2px solid;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  color: var(--mx-text-on-accent);
  flex-shrink: 0;
}

.level-emoji {
  position: absolute;
  top: -8px;
  right: -8px;
  font-size: 16px;
}

.title-section {
  min-width: 0;
}

.perm-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--mx-text);
  letter-spacing: -0.3px;
  margin: 0 0 2px;
}

.tool-name {
  font-size: 13px;
  font-family: var(--mx-font-mono);
  color: var(--mx-accent);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
  flex-shrink: 0;
}

.level-badge {
  padding: var(--mx-space-1) var(--mx-space-3);
  border-radius: var(--mx-radius-card);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border: 1px solid;
}

.expand-icon {
  color: var(--mx-text-tertiary);
  transition: transform 0.2s ease;
}

.perm-body {
  padding: 0 var(--mx-space-5) var(--mx-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-4);
}

.reason-block {
  padding: var(--mx-space-4);
  background: color-mix(in srgb, var(--mx-text) 3%, transparent);
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-card);
}

.reason-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--mx-text-tertiary);
  margin-bottom: var(--mx-space-2);
}

.reason-text {
  font-size: 13px;
  line-height: 1.7;
  color: var(--mx-text-secondary);
  margin: 0;
}

.action-buttons {
  display: flex;
  gap: var(--mx-space-3);
  justify-content: flex-end;
}

.deny-btn,
.grant-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-3) var(--mx-space-5);
  border-radius: var(--mx-radius-card);
  border: none;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.deny-btn:disabled,
.grant-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none !important;
  box-shadow: none !important;
}

/* 记住授权勾选框 */
.remember-option {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  justify-content: flex-end;
  cursor: pointer;
  user-select: none;
}

.remember-option input[type="checkbox"] {
  accent-color: var(--mx-accent);
  width: 14px;
  height: 14px;
  cursor: pointer;
}

.remember-option input[type="checkbox"]:disabled {
  cursor: not-allowed;
}

.remember-label {
  font-size: 12px;
  color: var(--mx-text-tertiary);
  font-weight: 500;
  white-space: nowrap;
}

.deny-btn {
  background: linear-gradient(135deg, var(--mx-hover), var(--mx-bg-elevated));
  color: var(--mx-text-secondary);
  border: 1px solid var(--mx-separator);
}

.deny-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px color-mix(in srgb, var(--mx-separator) 40%, transparent);
  border-color: var(--mx-danger);
  color: color-mix(in srgb, var(--mx-danger) 60%, white);
}

.deny-btn:active:not(:disabled) {
  transform: translateY(0);
}

.deny-btn:focus-visible,
.grant-btn:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 2px;
}

.grant-btn {
  color: var(--mx-text-on-accent);
  box-shadow: 0 4px 16px color-mix(in srgb, var(--mx-accent) 35%, transparent);
}

.grant-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 24px color-mix(in srgb, var(--mx-accent) 45%, transparent);
}

.grant-btn:active:not(:disabled) {
  transform: translateY(0);
}

.security-notice {
  padding: var(--mx-space-3) var(--mx-space-4);
  background: color-mix(in srgb, var(--mx-danger) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--mx-danger) 25%, transparent);
  border-radius: var(--mx-radius-control);
  font-size: 12px;
  color: color-mix(in srgb, var(--mx-danger) 60%, white);
  text-align: center;
  font-weight: 500;
}

/* Animations */
.expand-enter-active,
.expand-leave-active {
  transition: all 0.3s ease;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}
</style>
