<script setup lang="ts">
/**
 * 登录遮挡 Sheet（AuthRequiredSheet）：需要 MindX 账号身份的插件拉起它，
 * 全屏登录/注册表单集中注意力；登录/注册成功自动切到账户信息页（AccountSheet）。
 * 布局仿 Apple 登录页：大标题 + 框内嵌 label 大输入框 + 大圆角主按钮 + 底部切换链接。
 * 自动注册常态下用户已登录，本页只在自动注册失败（如服务端不可达）或用户退出登录后露面。
 * 错误一律 pushNotice 人话呈现，禁止开终端窗口甩 JSON。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'
import { useMarketStore } from '../store'
import { pushNotice } from '../notice'
import { SHEET_ACCOUNT, SHEET_AUTH_REQUIRED, SHEET_BROWSER } from '../ids'
import BrowserSheet from './BrowserSheet.vue'

const store = useMarketStore()
const shell = useShell()

const user = computed(() => store.account?.user ?? null)
/** 令牌失效：已录过令牌但服务端校验不过（文案改「登录已失效」） */
const tokenStale = computed(() => !!store.account && store.account.has_token && !user.value)

/** 登录/注册成功：Sheet 形态时本 Sheet 替换为账户信息页；
 * 设置页内嵌形态（不在 Sheet 中）不动壳，交由宿主响应式分流 */
async function showAccount(): Promise<void> {
  if (!shell.Sheet.has(SHEET_AUTH_REQUIRED)) return
  const { default: AccountSheet } = await import('./AccountSheet.vue')
  shell.Sheet.remove(SHEET_AUTH_REQUIRED)
  shell.Sheet.add({ id: SHEET_ACCOUNT, title: 'MindX 账号', component: AccountSheet as never })
}

/** 打开法律文本：内嵌 BrowserSheet（不开系统浏览器）。
 * 市场站点地址唯一来源 = 选中源 base_url（store.marketSite）；未加载先刷源目录，
 * 仍缺失则提示（不硬编码兜底地址——市场地址只允许在源目录一处修改）。
 * Sheet 互斥：先移除在场条目（本 Sheet 自身）再拉起文档页 */
async function openLegal(page: 'tos' | 'privacy'): Promise<void> {
  if (!store.marketSite && store.sources.length === 0) {
    await store.fetchSource().catch(() => {})
  }
  const base = store.marketSite
  if (!base) {
    pushNotice(shell, 'error', '暂时连不上社区，无法打开文档')
    return
  }
  const url = `${base.replace(/\/$/, '')}/${page}`
  const current = shell.Sheet.entries[0]
  if (current) shell.Sheet.remove(current.id)
  store.browserSheetUrl = url
  shell.Sheet.add({
    id: SHEET_BROWSER,
    title: page === 'tos' ? '服务条款' : '隐私声明',
    component: BrowserSheet as never,
  })
}

// ── 登录 / 注册（内联表单，视图切换） ─────────────────────────
const authMode = ref<'login' | 'register'>('login')
const authForm = reactive({ username: '', password: '', confirm: '', display_name: '' })
const authBusy = ref(false)

async function submitAuth(): Promise<void> {
  if (authBusy.value) return
  const username = authForm.username.trim()
  if (!username || !authForm.password) {
    pushNotice(shell, 'error', '请填写用户名和密码')
    return
  }
  authBusy.value = true
  try {
    if (authMode.value === 'register') {
      if (authForm.password.length < 8) {
        pushNotice(shell, 'error', '密码至少 8 位')
        return
      }
      if (authForm.password !== authForm.confirm) {
        pushNotice(shell, 'error', '两次输入的密码不一致')
        return
      }
      await store.registerAccount(username, authForm.password, authForm.display_name.trim())
      pushNotice(shell, 'success', '账号已创建，匿名评分已迁移到你的名下')
    } else {
      await store.loginAccount(username, authForm.password)
      pushNotice(shell, 'success', '已登录')
    }
    authForm.username = authForm.password = authForm.confirm = authForm.display_name = ''
    await showAccount()
  } catch (err: unknown) {
    // daemon 侧已把服务端错误翻译成人话（用户名已注册/用户名或密码不正确等）
    pushNotice(shell, 'error', err instanceof Error ? err.message : '操作失败，请稍后重试')
  } finally {
    authBusy.value = false
  }
}

// 打开瞬间已登录（自动注册/静默重登先于用户动作完成）：直接呈现账户信息
onMounted(() => {
  void store.fetchAccount().then(() => {
    if (store.account?.user) void showAccount()
  })
})
</script>

<template>
  <div :class="$style.wrap">
    <p v-if="store.accountLoading && !store.account" class="mx-text-loading">正在获取账号状态…</p>
    <p v-else-if="store.accountError" :class="$style.error">{{ store.accountError }}</p>

    <template v-else>
      <div :class="$style.header">
        <span :class="$style.bigAvatar"><MxIcon name="lucide:user-round" :size="20" /></span>
        <span :class="$style.headerName">{{ tokenStale ? '登录已失效' : 'MindX 账号' }}</span>
        <span :class="$style.headerId">一个账号，评分与发布跟随你走</span>
      </div>

      <p :class="$style.introNote">
        注册并不是强制的——即使不注册，也不会影响你的使用。只是，如果你想保存点赞的记录、让你下载的员工、团队、技能、插件能随同更新，或者希望将你的成果分享到社区，那就需要注册成为 MindX 的一员。
      </p>

      <!-- 登录视图 -->
      <form v-if="authMode === 'login'" :class="$style.authForm" @submit.prevent="submitAuth">
        <div :class="$style.bigField">
          <span :class="$style.bigLabel">用户名</span>
          <input v-model="authForm.username" :class="$style.bigInput" type="text" autocomplete="username" spellcheck="false" />
        </div>
        <div :class="$style.bigField">
          <span :class="$style.bigLabel">密码</span>
          <input v-model="authForm.password" :class="$style.bigInput" type="password" autocomplete="current-password" />
        </div>
        <button type="submit" :class="$style.bigBtn" :disabled="authBusy">
          {{ authBusy ? '请稍候…' : '登录' }}
        </button>
      </form>
      <p v-else-if="authMode === 'register'" :class="$style.authFormTitle">创建你的 MindX 账号</p>

      <!-- 注册视图 -->
      <form v-if="authMode === 'register'" :class="$style.authForm" @submit.prevent="submitAuth">
        <div :class="$style.bigField">
          <span :class="$style.bigLabel">用户名</span>
          <input v-model="authForm.username" :class="$style.bigInput" type="text" autocomplete="username" spellcheck="false" />
        </div>
        <div :class="$style.bigField">
          <span :class="$style.bigLabel">您的称呼（可选）</span>
          <input v-model="authForm.display_name" :class="$style.bigInput" type="text" maxlength="32" spellcheck="false" />
        </div>
        <div :class="$style.bigField">
          <span :class="$style.bigLabel">密码</span>
          <input v-model="authForm.password" :class="$style.bigInput" type="password" autocomplete="new-password" placeholder="至少 8 位" />
        </div>
        <div :class="$style.bigField">
          <span :class="$style.bigLabel">确认密码</span>
          <input v-model="authForm.confirm" :class="$style.bigInput" type="password" autocomplete="new-password" />
        </div>
        <button type="submit" :class="$style.bigBtn" :disabled="authBusy">
          {{ authBusy ? '请稍候…' : '创建账号' }}
        </button>
        <p :class="$style.tosNote">注册即表示你已阅读并同意<button type="button" :class="$style.noteLink" @click="openLegal('tos')">服务条款</button>与<button type="button" :class="$style.noteLink" @click="openLegal('privacy')">隐私声明</button>；历史匿名评分将迁移到账号名下。</p>
      </form>

      <!-- 底部切换链接（仿 Apple「没有 Apple 账户？立即创建」） -->
      <p :class="$style.authSwitch">
        <template v-if="authMode === 'login'">还没有账号？<button type="button" :class="$style.switchLink" @click="authMode = 'register'">创建一个</button></template>
        <template v-else>已有账号？<button type="button" :class="$style.switchLink" @click="authMode = 'login'">直接登录</button></template>
      </p>

      <p v-if="authMode === 'login'" :class="$style.note">登录后本设备自动绑定到账号；凭据保存在本机密钥存储中，重装应用后自动恢复登录。</p>
    </template>
  </div>
</template>

<style module>
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-4);
  /* width:100% 显式声明：父级 flex 列容器下 auto margin 会令子项收缩到内容宽 */
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  padding: var(--mx-space-4) var(--mx-space-4) var(--mx-space-6);
}

.error {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-state-error);
}

/* ── 头部：居中大头像 + 标题 + 副标题 ── */
.header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-4) 0;
  text-align: center;
}

.bigAvatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--mx-accent) 14%, transparent);
  color: var(--mx-accent);
  font: var(--mx-font-heading);
  font-size: 30px;
  font-weight: 700;
}

.headerName {
  font: var(--mx-font-heading);
  font-size: 20px;
  color: var(--mx-text);
}

.headerId {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

/* 注册说明段：注册非强制 + 注册收益，置于标题与表单之间 */
.introNote {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  line-height: 1.7;
  text-align: center;
}

/* ── 登录/注册表单（仿 Apple 登录页：大输入框框内嵌 label + 大圆角主按钮） ── */
.authForm {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-4);
}

.authFormTitle {
  margin: 0;
  font: var(--mx-font-body);
  font-size: 17px;
  color: var(--mx-text);
  text-align: center;
}

/* 大输入框：2px 恒定边框（聚焦变蓝不抖动），label 小字嵌框内顶部 */
.bigField {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 16px 9px;
  border: 2px solid color-mix(in srgb, var(--mx-text) 14%, transparent);
  border-radius: 12px;
  background: var(--mx-bg);
  transition: border-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.bigField:focus-within {
  border-color: var(--mx-accent);
}

.bigLabel {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.bigInput {
  padding: 0;
  border: none;
  background: transparent;
  font: var(--mx-font-body);
  font-size: 17px;
  color: var(--mx-text);
  outline: none;
}

.bigInput::placeholder {
  color: var(--mx-text-tertiary);
}

/* 主按钮：48px 高大圆角实底 */
.bigBtn {
  height: 48px;
  border: none;
  border-radius: 12px;
  background: var(--mx-accent);
  font: var(--mx-font-body);
  font-size: 16px;
  font-weight: 500;
  color: #fff;
  cursor: pointer;
  transition: background var(--mx-duration-fast) var(--mx-ease-standard);
}

.bigBtn:hover {
  background: color-mix(in srgb, var(--mx-accent) 88%, #000);
}

.bigBtn:disabled {
  opacity: 0.55;
  cursor: default;
}

.authSwitch {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  text-align: center;
}

.switchLink {
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: var(--mx-accent);
  cursor: pointer;
}

.switchLink:hover {
  text-decoration: underline;
}

.tosNote {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.noteLink {
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: var(--mx-accent);
  cursor: pointer;
}

.noteLink:hover {
  text-decoration: underline;
}

.note {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  text-align: center;
}
</style>
