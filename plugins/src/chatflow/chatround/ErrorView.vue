<script setup lang="ts">
// ErrorView —— 对话流内错误卡片（源：mindx-desktop ChatRound/ErrorView.vue）。
// 样式对齐统一卡片体系：单行 header（24×24 图标 wrap + 文案）+ 可折叠详情 body，
// 与 Bash/Read/Edit 等工具卡片同尺寸、同字号、同圆角，无阴影无动画。
// work 无 vue-i18n：文案改查证后的中文字面量（zh.json errorView.* 逐一核对）。
import { ref } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'

const props = defineProps({
  message: {
    type: String,
    default: ''
  },
  code: {
    type: [String, Number],
    default: ''
  },
  details: {
    type: String,
    default: ''
  },
  isRecoverable: {
    type: Boolean,
    default: false
  },
  /** LLM HTTP 错误分类：'rate_limit'（429 限流）| 'payment'（402 欠费/配置错误）| '' */
  httpClass: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['retry', 'dismiss', 'open-settings'])

const isExpanded = ref(false)

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

function handleRetry() {
  emit('retry')
}

function handleDismiss() {
  emit('dismiss')
}
</script>

<template>
  <div class="error-view">
    <!-- 单行 Header：图标 + 标题/消息 + 右侧操作 -->
    <div class="error-header">
      <span class="error-icon-wrap">
        <MxIcon name="lucide:circle-alert" :size="16" class="error-icon-glyph" />
      </span>

      <div class="error-content">
        <div class="error-title-row">
          <span class="error-title">执行错误</span>
          <span v-if="code" class="error-code">{{ code }}</span>
        </div>
        <p class="error-message">{{ message }}</p>
      </div>

      <div class="header-actions">
        <el-tooltip v-if="isRecoverable" content="重试" placement="top">
          <button class="action-btn" @click.stop="handleRetry">
            <MxIcon name="lucide:rotate-cw" :size="16" />
          </button>
        </el-tooltip>

        <el-tooltip v-if="details" :content="isExpanded ? '收起详情' : '查看详情'" placement="top">
          <button class="action-btn" @click.stop="toggleExpand">
            <MxIcon :name="isExpanded ? 'lucide:chevron-up' : 'lucide:chevron-down'" :size="16" />
          </button>
        </el-tooltip>

        <el-tooltip content="关闭" placement="top">
          <button class="action-btn" @click.stop="handleDismiss">
            <MxIcon name="lucide:x" :size="16" />
          </button>
        </el-tooltip>
      </div>
    </div>

    <!-- HTTP 错误分类提示：限流/超时/过载/服务端（可重试）与认证/欠费/权限/不存在/校验（不可重试） -->
    <div v-if="props.httpClass" class="error-hint" :class="props.httpClass">
      <template v-if="props.httpClass === 'rate_limit'">
        <span class="hint-text">请求过于频繁（429），请稍后重试或检查模型服务限流</span>
      </template>
      <template v-else-if="props.httpClass === 'payment'">
        <span class="hint-text">可能是 BaseURL 配置错误或 API Key 欠费/无效，请检查模型设置</span>
        <button class="hint-btn" type="button" @click.stop="emit('open-settings')">
          打开模型设置
        </button>
      </template>
      <template v-else-if="props.httpClass === 'timeout'">
        <span class="hint-text">请求超时，请稍后重试</span>
      </template>
      <template v-else-if="props.httpClass === 'overloaded'">
        <span class="hint-text">模型服务过载，请稍后重试</span>
      </template>
      <template v-else-if="props.httpClass === 'server'">
        <span class="hint-text">模型服务端异常，请稍后重试</span>
      </template>
      <template v-else-if="props.httpClass === 'auth'">
        <span class="hint-text">API Key 无效或已过期，请检查模型设置</span>
        <button class="hint-btn" type="button" @click.stop="emit('open-settings')">
          打开模型设置
        </button>
      </template>
      <template v-else-if="props.httpClass === 'forbidden'">
        <span class="hint-text">API Key 无权限访问该模型，请检查模型设置</span>
        <button class="hint-btn" type="button" @click.stop="emit('open-settings')">
          打开模型设置
        </button>
      </template>
      <template v-else-if="props.httpClass === 'not_found'">
        <span class="hint-text">模型不存在，请检查模型配置</span>
      </template>
      <template v-else-if="props.httpClass === 'validation'">
        <span class="hint-text">请求参数有误或超出上下文长度，请调整后重试</span>
      </template>
    </div>

    <!-- 错误详情：与 header 无缝一体的 body -->
    <transition name="expand">
      <pre v-show="isExpanded && details" class="error-details"><code>{{ details }}</code></pre>
    </transition>
  </div>
</template>

<style scoped>
.error-view {
  background: color-mix(in srgb, var(--mx-danger) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--mx-danger) 25%, transparent);
  border-radius: var(--mx-radius-control);
  overflow: hidden;
}

/* ─── 单行 header：与 .exec-header 同 padding / gap / 字号 ─── */
.error-header {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-2) var(--mx-space-3);
}

/* 图标 wrap：与 .tool-icon-wrap 同规格（24×24 + control 圆角），danger 变体 */
.error-icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--mx-radius-control);
  background: color-mix(in srgb, var(--mx-danger) 12%, transparent);
  color: var(--mx-danger);
  flex-shrink: 0;
}

.error-content {
  flex: 1;
  min-width: 0;
}

.error-title-row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  min-width: 0;
}

.error-title {
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-text);
  white-space: nowrap;
  flex-shrink: 0;
}

/* Header 与 Body 统一字号档，单行截断：详情见 Body，不重复展示 */
.error-message {
  margin: 0;
  font: var(--mx-font-caption);
  line-height: 1.5;
  color: var(--mx-text-secondary);
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.error-code {
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  font-weight: 600;
  color: var(--mx-danger);
  background: color-mix(in srgb, var(--mx-danger) 12%, transparent);
  padding: 1px var(--mx-space-2);
  border-radius: var(--mx-radius-control);
  white-space: nowrap;
  flex-shrink: 0;
}

/* ─── HTTP 错误分类提示区（429 限流 / 402 欠费或配置错误） ─── */
.error-hint {
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
  padding: var(--mx-space-2) var(--mx-space-3);
  border-top: 1px solid color-mix(in srgb, var(--mx-separator) 40%, transparent);
  font: var(--mx-font-caption);
  color: var(--mx-warning);
  background: color-mix(in srgb, var(--mx-warning) 8%, transparent);
}

.hint-text {
  flex: 1;
  line-height: 1.5;
}

.hint-btn {
  flex-shrink: 0;
  padding: var(--mx-space-1) var(--mx-space-3);
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-static-white);
  background: var(--mx-warning);
  border: none;
  border-radius: var(--mx-radius-control);
  cursor: pointer;
  transition: filter 0.2s;
}

.hint-btn:hover {
  filter: brightness(1.1);
}

/* ─── 右侧操作按钮：26×26，与消息流其它操作按钮一致 ─── */
.header-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-1);
  margin-left: auto;
  flex-shrink: 0;
}

.action-btn {
  width: 26px;
  height: 26px;
  border-radius: var(--mx-radius-control);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
  background: transparent;
  color: var(--mx-text-tertiary);
  padding: 0;
}

.action-btn:hover {
  background: color-mix(in srgb, var(--mx-danger) 15%, transparent);
  color: var(--mx-danger);
}

/* ─── 详情 body：border-top 衔接 header，等宽小字 ─── */
.error-details {
  margin: 0;
  padding: var(--mx-space-2) var(--mx-space-3) var(--mx-space-3);
  border-top: 1px solid color-mix(in srgb, var(--mx-danger) 20%, transparent);
  background: color-mix(in srgb, var(--mx-module) 35%, transparent);
  font: var(--mx-font-caption);
  font-family: var(--mx-font-mono);
  line-height: 1.6;
  color: var(--mx-text-tertiary);
  max-height: 240px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.error-details code {
  background: none;
  padding: 0;
  border: none;
  color: inherit;
}

/* Animations */
.expand-enter-active,
.expand-leave-active {
  transition: all 0.15s ease;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
}
</style>
