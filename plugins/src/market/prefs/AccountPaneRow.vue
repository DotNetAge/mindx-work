<script setup lang="ts">
/**
 * 账户设置页（§2.5，整页主体）：已绑定后的市场档案维护。
 * 显示名编辑（≤32 字服务端校验）+ 头像上传（点击经宿主桥 openImage 系统对话框，
 * 拖拽直接落文件；PNG/JPEG ≤1MB，服务端统一缩放 128×128）+ 只读 login/provider/points。
 * 未绑定时引导至市场账号 Sheet（绑定流程归 Sheet，本页只管绑定后的档案）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'
import { useMarketStore } from '../store'
import { pushNotice } from '../notice'
import AccountSheet from '../overlays/AccountSheet.vue'
import { SHEET_ACCOUNT } from '../ids'

const store = useMarketStore()
const shell = useShell()

const user = computed(() => store.account?.user ?? null)

// ── 显示名编辑 ──
const nickDraft = ref('')
const nickDirty = ref(false)

// 档案到达/刷新时同步草稿（未编辑状态下跟随服务端值）
watch(user, () => {
  if (!nickDirty.value) nickDraft.value = user.value?.nick_name ?? ''
}, { immediate: true })

function onNickInput(): void {
  nickDirty.value = true
}

async function saveNick(): Promise<void> {
  const nick = nickDraft.value.trim()
  if (!nick || !user.value) return
  try {
    await store.updateProfile(nick)
    nickDirty.value = false
    pushNotice(shell, 'success', '显示名已更新')
  } catch (err: unknown) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '显示名更新失败')
  }
}

// ── 头像上传（点击 + 拖拽；≤1MB PNG/JPEG 前端先挡，base64 承载走 RPC） ──
const AVATAR_MAX_BYTES = 1024 * 1024
const avatarHover = ref(false)

function pickImage(): void {
  const openImage = window.mxDesktop?.dialog?.openImage
  if (!openImage) {
    pushNotice(shell, 'error', '当前环境不支持选择图片（需要应用宿主）')
    return
  }
  void openImage().then((picked) => {
    if (picked?.data_base64) uploadAvatar(picked.data_base64, picked.filename || 'avatar.png')
  })
}

function uploadAvatar(dataBase64: string, filename: string): void {
  void store
    .uploadAvatar(dataBase64, filename)
    .then(() => {
      pushNotice(shell, 'success', '头像已更新')
    })
    .catch((err: unknown) => {
      pushNotice(shell, 'error', err instanceof Error ? err.message : '头像上传失败')
    })
}

function readFileAsBase64(file: File): void {
  if (file.size > AVATAR_MAX_BYTES) {
    pushNotice(shell, 'error', '头像图片需小于 1MB')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = String(reader.result || '')
    const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : ''
    if (base64) uploadAvatar(base64, file.name || 'avatar.png')
  }
  reader.readAsDataURL(file)
}

function onDrop(event: DragEvent): void {
  avatarHover.value = false
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
    pushNotice(shell, 'error', '仅支持 PNG 或 JPEG 图片')
    return
  }
  readFileAsBase64(file)
}

// ── 未绑定引导：打开账号 Sheet（remove+add 互斥惯例） ──
function openAccountSheet(): void {
  if (shell.Sheet.has(SHEET_ACCOUNT)) shell.Sheet.remove(SHEET_ACCOUNT)
  shell.Sheet.add({ id: SHEET_ACCOUNT, title: '市场账号', component: AccountSheet as never })
}

onMounted(() => {
  void store.fetchAccount()
})
</script>

<template>
  <div :class="$style.wrap">
    <span :class="$style.title">账户</span>

    <p v-if="store.accountLoading && !store.account" class="mx-text-loading">正在获取账号状态…</p>

    <!-- ── 未绑定：引导至账号 Sheet ── -->
    <div v-else-if="!user" :class="$style.unbound">
      <p :class="$style.hint">
        {{ store.account?.has_token ? '登录令牌已失效，请重新绑定市场账号。' : '尚未绑定市场账号。绑定后可评分、发布并管理你的设备。' }}
      </p>
      <button type="button" class="mx-btn mx-btn--primary" @click="openAccountSheet">绑定市场账号</button>
    </div>

    <!-- ── 已绑定：档案维护 ── -->
    <template v-else>
      <div
        :class="$style.avatarBox"
        :data-hover="avatarHover ? 'true' : 'false'"
        @click="pickImage()"
        @dragover.prevent="avatarHover = true"
        @dragleave="avatarHover = false"
        @drop.prevent="onDrop($event)"
      >
        <img v-if="user.avatar_url" :class="$style.avatar" :src="user.avatar_url" :alt="user.nick_name || user.login" />
        <span v-else :class="$style.avatar">{{ (user.nick_name || user.login).charAt(0).toUpperCase() }}</span>
        <span :class="$style.avatarMask"><MxIcon name="lucide:camera" :size="16" /></span>
      </div>
      <p :class="$style.hint">点击或拖拽图片更换头像（PNG/JPEG，≤1MB，服务端统一缩放至 128×128）</p>

      <div class="mx-pref-row">
        <div class="mx-pref-label">
          <span class="mx-pref-title">显示名</span>
          <span class="mx-pref-desc">市场内展示的昵称（≤32 字），改后货架与评分处即时生效</span>
        </div>
        <div :class="$style.nickEdit">
          <input
            v-model="nickDraft"
            class="mx-input"
            :class="$style.nickInput"
            maxlength="32"
            spellcheck="false"
            @input="onNickInput()"
            @keyup.enter="saveNick()"
          />
          <button type="button" class="mx-btn mx-btn--primary" :disabled="!nickDirty || !nickDraft.trim() || store.accountBusy" @click="saveNick()">
            保存
          </button>
        </div>
      </div>

      <div class="mx-pref-row">
        <div class="mx-pref-label">
          <span class="mx-pref-title">登录名</span>
          <span class="mx-pref-desc">GitHub OAuth 身份，不可修改</span>
        </div>
        <span :class="$style.readonly">@{{ user.login }}</span>
      </div>

      <div class="mx-pref-row">
        <div class="mx-pref-label">
          <span class="mx-pref-title">登录方式</span>
          <span class="mx-pref-desc">账号关联的 OAuth 提供方</span>
        </div>
        <span :class="$style.readonly">{{ user.provider }}</span>
      </div>

      <div class="mx-pref-row">
        <div class="mx-pref-label">
          <span class="mx-pref-title">积分</span>
          <span class="mx-pref-desc">由发布、下载与评分等贡献行为累计（服务端记账）</span>
        </div>
        <span :class="$style.readonly">{{ user.points }}</span>
      </div>
    </template>
  </div>
</template>

<style module>
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-4);
  padding: var(--mx-space-4) 0;
}

.title {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.unbound {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--mx-space-3);
}

.hint {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

/* 头像编辑盒：圆形头像 + hover 蒙层（点击/拖拽双通道） */
.avatarBox {
  position: relative;
  align-self: flex-start;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  cursor: pointer;
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--mx-accent) 14%, transparent);
  color: var(--mx-accent);
  font-weight: 700;
  object-fit: cover;
}

.avatarMask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--mx-bg-window) 55%, transparent);
  color: var(--mx-text);
  opacity: 0;
  transition: opacity var(--mx-duration-fast) var(--mx-ease-standard);
}

.avatarBox:hover .avatarMask,
.avatarBox[data-hover='true'] .avatarMask {
  opacity: 1;
}

.nickEdit {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
}

.nickInput {
  width: 220px;
}

.readonly {
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
  font-variant-numeric: tabular-nums;
}
</style>
