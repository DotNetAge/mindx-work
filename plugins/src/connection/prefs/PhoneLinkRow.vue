<script setup lang="ts">
/**
 * 手机连接行：Switch 启停 + 展开式详情（官方/自建 AgentHub 双选项、服务器地址、通道状态、配对短码）。
 * 移植自 mindx-desktop PhoneLinkPane；交互按设计调整：未启用时行内只显示开关，
 * 启用后才展开配置区（蓝本为常展开面板，此处为 mindx-work 版式变体）。
 * - 开 = 保存配置（上次为自建地址则恢复之，否则官方地址 DEFAULT_CHANNEL_URL——本地调试占位，发版改 mindx.chat）
 * - 关 = 清空配置（channel_url 置空，daemon 通道未配置；自建地址会话内记忆，重开自动恢复）
 * 配对同意闸与短码弹窗归 phone-pair 插件全局层，本行只消费 channel.status 做展示；
 * 编辑态（savedMode/customUrl）为 channel.ts 模块级单例，与自建地址 modal 共享。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useService, useShell } from '@mindx-work/ui-shell-vue'
import { DAEMON_CONNECTION_SERVICE, type DaemonConnection } from '../runtime'
import {
  DEFAULT_CHANNEL_URL,
  savedMode,
  customUrl,
  channelStateText,
  channelStateKind,
  fetchChannelStatus,
  readUserConfig,
  persistChannelUrl,
  reconcileChannelEnabled,
  type ChannelStatus,
} from '../channel'
import { pushNotice } from '../notice'
import { MODAL_CONN_CHANNEL_URL } from '../ids'
import ChannelUrlModal from '../overlays/ChannelUrlModal.vue'

const shell = useShell()
const conn = useService<DaemonConnection>(DAEMON_CONNECTION_SERVICE)

type LinkMode = 'default' | 'custom'

/** 界面选择的连接方式（启用后展示；与已保存模式分离，切换即编排保存/弹窗） */
const mode = ref<LinkMode>('default')
/** 启停进行中：防连点（开关期间禁用） */
const switching = ref(false)
/** 通道状态（行挂载期轮询；卸载即停，不在页面外空转） */
const status = ref<ChannelStatus | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

/** 启用中 = 存在已保存配置（保存成功即亮，失败自动弹回） */
const enabled = computed(() => savedMode.value !== '')

const stateText = computed(() => channelStateText(status.value))
const stateColor = computed(() => {
  switch (channelStateKind(status.value)) {
    case 'success':
      return 'var(--mx-state-success)'
    case 'warn':
      return 'var(--mx-state-warn)'
    case 'fail':
      return 'var(--mx-state-error)'
    default:
      return 'var(--mx-text-caption)'
  }
})

/** 当前生效地址：优先服务端状态，回退本地记录（蓝本同链） */
const activeUrl = computed(
  () => status.value?.url || customUrl.value || (mode.value === 'default' ? DEFAULT_CHANNEL_URL : ''),
)

async function refresh(): Promise<void> {
  try {
    status.value = await fetchChannelStatus(conn.call)
    // daemon 为事实源：每轮回流校准开关（外部改动/跨会话启用自动映像到界面）
    reconcileChannelEnabled(status.value)
  } catch {
    // daemon 未连接/超时：保留上次状态，下轮轮询自动恢复
  }
}

onMounted(() => {
  void refresh()
  pollTimer = setInterval(() => void refresh(), 5000)
  // 初始化：读当前生效配置，推断已保存模式与界面选择（蓝本同款推断链）
  void readUserConfig(conn.call)
    .then((cfg) => {
      const url = cfg.channel_url || ''
      if (!url) {
        savedMode.value = ''
        mode.value = 'default'
      } else if (url === DEFAULT_CHANNEL_URL) {
        savedMode.value = 'default'
        mode.value = 'default'
      } else {
        savedMode.value = 'custom'
        customUrl.value = url
        mode.value = 'custom'
      }
    })
    .catch(() => {
      // 读配置失败：保持界面缺省（状态轮询仍工作）
    })
})

/** 启停编排：开 = 恢复上次模式（无记忆则官方）；关 = 清配置。失败推通知并由 enabled 自动弹回 */
async function toggle(): Promise<void> {
  if (switching.value) return
  switching.value = true
  try {
    if (enabled.value) {
      await persistChannelUrl(conn.call, '')
      pushNotice(shell, 'success', '手机连接已停用')
    } else {
      const url = savedMode.value === 'custom' && customUrl.value.trim() ? customUrl.value : DEFAULT_CHANNEL_URL
      mode.value = url === DEFAULT_CHANNEL_URL ? 'default' : 'custom'
      await persistChannelUrl(conn.call, url)
      pushNotice(shell, 'success', '手机连接已启用')
    }
    void refresh()
  } catch (err) {
    pushNotice(shell, 'error', '保存手机连接配置失败' + (err instanceof Error ? `：${err.message}` : ''))
  } finally {
    switching.value = false
  }
}

// 官方保存失败：回退到已保存模式（抑制标志防「回退再次弹窗」循环，蓝本同款）
function fallbackFromDefault(): void {
  const fallback = savedMode.value || 'custom'
  if (mode.value === fallback) return
  suppressPrompt = true
  mode.value = fallback
}

// 切换连接方式：官方直接写配置；自建无地址时打开地址 modal。
// suppressPrompt：官方保存失败自动回退自建时不弹地址框（仅用户主动点选自建才弹）。
let suppressPrompt = false
watch(mode, async (val) => {
  if (!enabled.value) return
  if (val === savedMode.value && val === 'default' && status.value?.configured) return
  if (val === 'default') {
    try {
      await persistChannelUrl(conn.call, DEFAULT_CHANNEL_URL)
      pushNotice(shell, 'success', '手机连接配置已保存')
      void refresh()
    } catch (err) {
      pushNotice(shell, 'error', '保存手机连接配置失败' + (err instanceof Error ? `：${err.message}` : ''))
      fallbackFromDefault()
    }
  } else if (!customUrl.value.trim()) {
    // 自动回退（非用户主动点选）不弹地址框
    if (suppressPrompt) {
      suppressPrompt = false
      return
    }
    if (shell.Overlay.has(MODAL_CONN_CHANNEL_URL)) shell.Overlay.remove(MODAL_CONN_CHANNEL_URL)
    shell.Overlay.add({ id: MODAL_CONN_CHANNEL_URL, kind: 'modal', component: ChannelUrlModal })
  }
})

// ── 配对短码倒计时：以服务端 code_expires_in 为基准，本地每秒递减插值 ──
const shortCode = computed(() => status.value?.code || '')
const countdown = ref(0)
let countdownTimer: ReturnType<typeof setInterval> | null = null
watch(shortCode, (code) => {
  countdown.value = code ? (status.value?.code_expires_in ?? 60) : 0
})
countdownTimer = setInterval(() => {
  if (countdown.value > 0) countdown.value--
}, 1000)

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (countdownTimer) clearInterval(countdownTimer)
})
</script>

<template>
  <div :class="$style.wrap">
    <!-- 首行：标题 + 描述 + 启用开关（未启用时行内仅此而已） -->
    <div class="mx-pref-row">
      <div class="mx-pref-label">
        <span class="mx-pref-title">手机连接</span>
        <span class="mx-pref-desc">通过 AgentHub 服务，手机客户端可在局域网或外网中安全访问本桌面控制台</span>
      </div>
      <button
        class="mx-switch"
        role="switch"
        :aria-checked="enabled"
        :disabled="switching"
        @click="toggle()"
      >
        <span class="mx-switch-thumb" />
      </button>
    </div>

    <!-- 启用后才展开：连接方式 / 服务器地址 / 通道状态 / 配对短码 -->
    <template v-if="enabled">
      <!-- 连接方式（双选项互斥，蓝本同款卡片） -->
      <div :class="$style.options">
        <div
          role="button"
          tabindex="0"
          :class="[$style.option, { [$style.optionActive]: mode === 'default' }]"
          @click="mode = 'default'"
          @keydown.enter.prevent="mode = 'default'"
        >
          <span :class="$style.optionTitle">使用官方的 AgentHub 服务连接手机</span>
          <span :class="$style.optionDesc">使用官方提供的 AgentHub 服务，允许手机客户端通过安全数据通道访问桌面控制台</span>
        </div>
        <div
          role="button"
          tabindex="0"
          :class="[$style.option, { [$style.optionActive]: mode === 'custom' }]"
          @click="mode = 'custom'"
          @keydown.enter.prevent="mode = 'custom'"
        >
          <span :class="$style.optionTitle">使用自建的 AgentHub 服务连接手机</span>
          <span :class="$style.optionDesc">通过您搭建的外部 AgentHub 服务器进行连接</span>
        </div>
      </div>

      <!-- 当前生效地址 -->
      <div v-if="activeUrl" :class="$style.urlRow">
        <span :class="$style.label">当前服务器地址</span>
        <span :class="$style.url">{{ activeUrl }}</span>
      </div>

      <!-- 通道状态 -->
      <div :class="$style.stateRow">
        <span :class="$style.label">通道状态</span>
        <span :class="$style.state">
          <span class="mx-dot" :style="{ color: stateColor }" />
          {{ stateText }}
        </span>
      </div>
      <span v-if="status?.error" :class="$style.stateError">{{ status.error }}</span>

      <!-- 配对短码 -->
      <div v-if="shortCode" :class="$style.codeRow">
        <span :class="$style.label">配对短码</span>
        <span :class="$style.code">{{ shortCode }}<i :class="$style.countdown">{{ countdown }}s</i></span>
        <p :class="$style.codeDesc">在手机端输入该短码完成配对；短码 60 秒有效，过期后自动刷新。</p>
      </div>
      <p v-else-if="status?.paired" :class="$style.pairedTip">手机已与桌面配对，可在手机端直接访问桌面控制台。</p>
    </template>
  </div>
</template>

<style module>
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
}

.state {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-2);
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  white-space: nowrap;
}

/* 连接方式选项：单选卡片，含原文说明（蓝本 .pl-option 同构，token 化） */
.options {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
}

.option {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  padding: var(--mx-space-3);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-card);
  cursor: pointer;
  transition:
    background-color var(--mx-duration-fast) var(--mx-ease-standard),
    border-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.option:hover {
  background: var(--mx-hover);
}

.optionActive {
  border-color: var(--mx-border-selected);
  background: var(--mx-hover);
}

.optionTitle {
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.optionDesc {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  line-height: 1.5;
}

.urlRow,
.stateRow {
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
}

.label {
  flex: none;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.url {
  font: 400 12px/18px ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace;
  color: var(--mx-text);
  word-break: break-all;
}

.stateError {
  font: var(--mx-font-caption);
  color: var(--mx-state-error);
  word-break: break-all;
}

/* 配对短码：等宽大字 + 倒计时（蓝本 mono 展示，token 化） */
.codeRow {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  padding-top: var(--mx-space-2);
  border-top: 0.5px solid var(--mx-separator);
}

.code {
  align-self: flex-start;
  display: inline-flex;
  align-items: baseline;
  gap: var(--mx-space-2);
  font-family: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 6px;
  color: var(--mx-text);
  user-select: text;
}

.countdown {
  font-style: normal;
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0;
  color: var(--mx-text-secondary);
}

.codeDesc {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  line-height: 1.5;
}

.pairedTip {
  margin: 0;
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
}
</style>
