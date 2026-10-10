<script setup lang="ts">
/**
 * 市场账号 Sheet（§2.4，全屏抽层内容组件：头部壳渲染，本体填充滚动区）。
 * 三态呈现：已绑定（档案区）/ 令牌失效（重新登录引导）/ 匿名（设备身份 + 登录引导）。
 * 登录走设备授权（device flow）：点「登录市场账号」→ 应用内窗口打开官网确认页
 * → 用户登录 GitHub 并点「授权此设备」→ daemon 后台收口（校验 + 绑定迁移）。
 * 全程无短码、无令牌粘贴；轮询与编排状态在 store 层。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'
import { useMarketStore } from '../store'
import { pushNotice } from '../notice'

const store = useMarketStore()
const shell = useShell()

/** 本组件内正在发起登录（按钮态；编排 pending 延续时同样保持） */
const launching = ref(false)

const user = computed(() => store.account?.user ?? null)
/** 令牌失效：已录过令牌但服务端校验不过（token_error 带原因），引导重新登录 */
const tokenStale = computed(() => !!store.account && store.account.has_token && !user.value)
/** 匿名期：无令牌，展示设备身份 */
const anonymous = computed(() => !!store.account && !store.account.has_token)

/** 设备身份短码（client_uuid 前 8 位，仅展示不承载语义） */
const clientIdShort = computed(() => (store.account?.client_id ?? '').slice(0, 8))

/** 登录编排进行中（发起动作与 daemon 后台流程均算） */
const loginPending = computed(() => launching.value || store.deviceLoginPhase === 'pending')

async function startLogin(): Promise<void> {
  launching.value = true
  try {
    await store.startDeviceLogin()
  } catch (err: unknown) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '登录发起失败')
  } finally {
    launching.value = false
  }
}

// 编排落定：成功提示（账号刷新在 store 轮询里已完成）；失败错误已在界面呈现
watch(
  () => store.deviceLoginPhase,
  (phase, prev) => {
    if (phase === 'done' && prev && prev !== 'done') {
      pushNotice(shell, 'success', '已绑定市场账号，匿名评分已迁移到你的名下')
    }
  }
)

onMounted(() => {
  // 账号状态即刷（设备授权确认页 URL 由 daemon 拼装，无需本侧源清单）
  void store.fetchAccount()
})

onUnmounted(() => {
  store.disposeDeviceLogin()
})
</script>

<template>
  <div :class="$style.wrap">
    <p v-if="store.accountLoading && !store.account" class="mx-text-loading">正在获取账号状态…</p>
    <p v-else-if="store.accountError" :class="$style.error">{{ store.accountError }}</p>

    <!-- ── 已绑定：档案区（单向绑定，不支持解绑） ── -->
    <template v-else-if="user">
      <div :class="$style.profile">
        <img v-if="user.avatar_url" :class="$style.avatar" :src="user.avatar_url" :alt="user.nick_name || user.login" />
        <span v-else :class="$style.avatar">{{ (user.nick_name || user.login).charAt(0).toUpperCase() }}</span>
        <div :class="$style.profileText">
          <span :class="$style.profileName">{{ user.nick_name || user.login }}</span>
          <span :class="$style.profileMeta">@{{ user.login }} · {{ user.provider }}</span>
          <span :class="$style.profileMeta">积分 {{ user.points }}</span>
        </div>
      </div>
      <p :class="$style.note">本设备已绑定市场账号（绑定单向，不可解绑）；评分与发布都挂在这个身份下。</p>
    </template>

    <!-- ── 匿名 / 令牌失效：一键设备授权登录 ── -->
    <template v-else>
      <div :class="$style.statusHead">
        <span :class="$style.statusTitle">{{ tokenStale ? '登录令牌已失效' : '当前为匿名设备身份' }}</span>
        <span v-if="anonymous" :class="$style.statusMeta">设备短码 {{ clientIdShort || '—' }}</span>
        <span v-else-if="tokenStale" :class="$style.statusMeta">{{ store.account?.token_error || '令牌校验失败' }}</span>
      </div>

      <p :class="$style.note">
        点击登录后会在应用内打开市场官网：登录你的 GitHub 账号并点「授权此设备」即可完成绑定。
      </p>

      <button type="button" class="mx-btn mx-btn--primary" :disabled="loginPending" @click="startLogin">
        <MxIcon name="lucide:log-in" :size="16" />
        <span v-if="loginPending" class="mx-text-loading">等待你在官网确认…</span>
        <template v-else>登录市场账号</template>
      </button>
      <p v-if="store.deviceLoginPhase === 'error' && store.deviceLoginError" :class="$style.error">
        {{ store.deviceLoginError }}
      </p>

      <p :class="$style.note">绑定后你的历史匿名评分会迁移到账号名下；评分、发布与设备管理都以该身份进行。</p>
    </template>
  </div>
</template>

<style module>
.wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--mx-space-4);
  max-width: 640px;
  margin: 0 auto;
  padding: var(--mx-space-4);
}

.error {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-state-error);
}

/* 档案区：头像 + 三行文本 */
.profile {
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--mx-accent) 14%, transparent);
  color: var(--mx-accent);
  font-weight: 700;
  object-fit: cover;
}

.profileText {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.profileName {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.profileMeta {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.note {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

/* 状态头（匿名/令牌失效） */
.statusHead {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.statusTitle {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.statusMeta {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  font-variant-numeric: tabular-nums;
}
</style>
