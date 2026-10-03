<script setup lang="ts">
/**
 * 授权进度弹窗（纯内容组件，卡片壳由 Overlay 容器提供）。
 * 视图 = flow.ts 的流程状态单例：callback 态呈现「已打开浏览器 + 等待回调」；
 * device_code / user_code 态呈现大号用户码 + 打开网址 + 等待轮询；
 * 收尾态（成功/失败/取消）由 oauth.flow_* 通知驱动。挂载即发起授权 RPC，
 * 等待中关闭弹窗 = 取消流程（daemon 侧中断 gochat 授权）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useService, useShell } from '@mindx-work/ui-shell-vue'
import type { DaemonConnection } from '../../connection/runtime'
import { cancelAuthorize, startAuthorize } from '../runtime'
import { endFlow, oauthFlow } from '../flow'
import { MODAL_OAUTH_AUTHORIZE } from '../ids'

const shell = useShell()
const conn = useService<DaemonConnection>('daemon.connection')

/** device_code 有效期倒计时（秒；本地递减插值，超时判定归 daemon） */
const countdown = ref(0)
let countdownTimer: ReturnType<typeof setInterval> | null = null

const isWaiting = computed(() => oauthFlow.phase === 'connecting' || oauthFlow.phase === 'waiting')
const verifyHost = computed(() => {
  try {
    return new URL(oauthFlow.verifyUrl).host
  } catch {
    return oauthFlow.verifyUrl
  }
})

function close(): void {
  shell.Overlay.remove(MODAL_OAUTH_AUTHORIZE)
}

async function abortAndClose(): Promise<void> {
  if (isWaiting.value && oauthFlow.provider) {
    try {
      await cancelAuthorize(conn.call, oauthFlow.provider)
    } catch {
      // 取消失败不阻断关闭：流程至多存活到自身超时
    }
  }
  endFlow()
  close()
}

function reopenBrowser(): void {
  const url = oauthFlow.interaction === 'callback' ? oauthFlow.authUrl : oauthFlow.verifyUrl
  if (!url) return
  if (window.mxDesktop?.openExternal) {
    void window.mxDesktop.openExternal(url)
    return
  }
  window.open(url, '_blank', 'noopener')
}

watch(
  () => oauthFlow.expiresIn,
  (v) => {
    countdown.value = v > 0 ? v : 0
  },
)
countdownTimer = setInterval(() => {
  if (countdown.value > 0) countdown.value--
}, 1000)

onMounted(() => {
  if (!oauthFlow.provider) return
  startAuthorize(conn.call, oauthFlow.provider).catch((err) => {
    oauthFlow.phase = 'failed'
    oauthFlow.error = err instanceof Error ? err.message : '发起授权失败'
  })
})

onBeforeUnmount(() => {
  if (countdownTimer) clearInterval(countdownTimer)
})
</script>

<template>
  <div :class="$style.body">
    <span :class="$style.title">{{ oauthFlow.title || oauthFlow.provider || 'OAuth 授权' }}</span>

    <!-- 连接态：daemon 正在准备（起监听 / 请求设备码） -->
    <div v-if="oauthFlow.phase === 'connecting'" :class="$style.center">
      <span :class="$style.breath" />
      <span :class="$style.hint">正在准备授权…</span>
    </div>

    <!-- 等待态：按交互方式呈现 -->
    <template v-else-if="isWaiting">
      <!-- callback：预告卡 + 浏览器已拉起 -->
      <template v-if="oauthFlow.interaction === 'callback'">
        <p :class="$style.desc">
          已在系统浏览器打开 <strong>{{ oauthFlow.title }}</strong> 的授权页面。在浏览器中完成授权后，本窗口会自动继续。
        </p>
        <button type="button" class="mx-btn" @click="reopenBrowser()">重新打开授权页面</button>
      </template>

      <!-- device_code / user_code：展示码 + 打开网址 + 轮询等待 -->
      <template v-else>
        <p :class="$style.desc">
          请在浏览器打开 <strong>{{ verifyHost }}</strong
          >，输入以下用户码完成授权：
        </p>
        <span :class="$style.code">{{ oauthFlow.userCode }}</span>
        <div :class="$style.codeActions">
          <button type="button" class="mx-btn mx-btn--primary" @click="reopenBrowser()">打开授权网址</button>
          <span v-if="oauthFlow.interaction === 'device_code' && countdown > 0" :class="$style.countdown">{{ countdown }}s 内有效</span>
        </div>
      </template>

      <div :class="$style.center">
        <span :class="$style.breath" />
        <span :class="$style.hint">等待授权完成…</span>
      </div>
    </template>

    <!-- 收尾态 -->
    <div v-else-if="oauthFlow.phase === 'success'" :class="$style.center">
      <span :class="$style.successText">授权完成</span>
      <span :class="$style.hint">{{ oauthFlow.title }} 的凭据已安全保存。</span>
    </div>
    <div v-else-if="oauthFlow.phase === 'failed'" :class="$style.center">
      <span :class="$style.errorText">授权失败</span>
      <span :class="$style.error">{{ oauthFlow.error }}</span>
    </div>
    <div v-else :class="$style.center">
      <span :class="$style.hint">授权已取消。</span>
    </div>

    <div :class="$style.actions">
      <button
        v-if="isWaiting"
        type="button"
        class="mx-btn"
        @click="abortAndClose()"
      >
        取消授权
      </button>
      <button v-else type="button" class="mx-btn" :class="{ 'mx-btn--primary': oauthFlow.phase === 'success' }" @click="close()">
        {{ oauthFlow.phase === 'success' ? '完成' : '关闭' }}
      </button>
    </div>
  </div>
</template>

<style module>
.body {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
}

.title {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.desc {
  margin: 0;
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
  line-height: 1.6;
}

.desc strong {
  color: var(--mx-text);
  font-weight: 600;
}

.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-2) 0;
}

.hint {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

/* 呼吸闪动的等待指示（对齐连接态图标偏好，不转圈） */
.breath {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--mx-accent);
  animation: oauthBreath 1.6s ease-in-out infinite;
}

@keyframes oauthBreath {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .breath {
    animation: none;
    opacity: 0.7;
  }
}

/* 用户码：等宽大字 + 宽字距（对齐配对短码版式） */
.code {
  align-self: center;
  font-family: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 6px;
  color: var(--mx-text);
  user-select: text;
}

.codeActions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--mx-space-3);
}

.countdown {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.successText {
  font: var(--mx-font-heading);
  color: var(--mx-state-success);
}

.errorText {
  font: var(--mx-font-heading);
  color: var(--mx-state-error);
}

.error {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  word-break: break-all;
  text-align: center;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
  margin-top: var(--mx-space-2);
}
</style>
