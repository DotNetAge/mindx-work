<script setup lang="ts">
/**
 * 账户设置 Sheet（全屏抽层内容组件：头部壳渲染，本体填充滚动区）。
 * 2026-10-10 账号机制定案重做，布局仿 macOS「Apple 账户」：
 *   顶部居中大头像 + 称呼 + 账号 ID；
 *   行卡组（个人信息 → 内联编辑 Profile 四字段 / 登录与安全 → 用户名；退出登录置页面最底部）。
 * 2026-10-11 设备分组重做：原 connection 插件「远程连接」设置页并入「设备」单分组
 *   （服务端登录记录 + 设备接入总开关 + 已授权设备 + 附近设备自动扫描直连 + 添加连接）。
 *   同日用户定案：传入连接不分手机与电脑——手机链路与 Mac 直连同受总闸约束，
 *   原独立「手机连接」开关行及 AgentHub 配置 UI 整体移除；附近设备打开页面即自动扫描。
 * 自动注册常态下本页直接呈现账户信息；登录/注册拆到 AuthRequiredSheet（accountSheets.ts 分流），
 * 退出登录后自动切往登录遮挡页。错误一律 pushNotice 人话呈现，禁止开终端窗口甩 JSON。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { MxIcon, useService, useShell } from '@mindx-work/ui-shell-vue'
import { useMarketStore } from '../store'
import { pushNotice } from '../notice'
import { openAuthRequiredSheet } from './accountSheets'
import DeviceAddressModal from './DeviceAddressModal.vue'
import { MODAL_DEVICE_ADDRESS } from '../ids'

const store = useMarketStore()
const shell = useShell()

const user = computed(() => store.account?.user ?? null)
/** 令牌失效：已录过令牌但服务端校验不过（引导重新登录） */
const tokenStale = computed(() => !!store.account && store.account.has_token && !user.value)

// ── 头像上传（点击经宿主桥 openImage 选图；PNG/JPEG ≤1MB 前端先挡，base64 承载走 RPC） ──
const AVATAR_MAX_BYTES = 1024 * 1024
const avatarHover = ref(false)

function pickImage(): void {
  if (!user.value) return
  const openImage = window.mxDesktop?.dialog?.openImage
  if (!openImage) {
    pushNotice(shell, 'error', '当前环境不支持选择图片（需要应用宿主）')
    return
  }
  void openImage().then((picked) => {
    if (picked?.data_base64) void store.uploadAvatar(picked.data_base64, picked.filename || 'avatar.png')
      .then(() => pushNotice(shell, 'success', '头像已更新'))
      .catch((err: unknown) => pushNotice(shell, 'error', err instanceof Error ? err.message : '头像上传失败'))
  })
}

/** 拖拽落图：与点击同链路（类型/大小前端先挡） */
function onAvatarDrop(event: DragEvent): void {
  avatarHover.value = false
  if (!user.value) return
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
    pushNotice(shell, 'error', '仅支持 PNG 或 JPEG 图片')
    return
  }
  if (file.size > AVATAR_MAX_BYTES) {
    pushNotice(shell, 'error', '头像图片需小于 1MB')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = String(reader.result || '')
    const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : ''
    if (base64) void store.uploadAvatar(base64, file.name || 'avatar.png')
      .then(() => pushNotice(shell, 'success', '头像已更新'))
      .catch((err: unknown) => pushNotice(shell, 'error', err instanceof Error ? err.message : '头像上传失败'))
  }
  reader.readAsDataURL(file)
}

// ── 个人信息（常驻行内编辑：字段即列表行，change 即存，无只读/编辑双态） ──
/** 「个人信息」组：称呼/职位（展示身份） */
const profileIdentityFields = [
  { key: 'nick_name', label: '称呼', type: 'text', max: 32, placeholder: '怎么称呼你' },
  { key: 'job_title', label: '职位', type: 'text', max: 32, placeholder: '如：产品经理' },
] as const

/** 「登录与安全」组：手机（登录凭据）/ GitHub（发布署名） */
const profileSecurityFields = [
  { key: 'phone', label: '手机', type: 'tel', max: 11, placeholder: '用于登录' },
  { key: 'github', label: 'GitHub', type: 'text', max: 64, placeholder: 'GitHub 用户名' },
] as const

/** 草稿初值取自当前用户（本组件仅在已登录态挂载，user 必非空） */
const u0 = user.value
const profileForm = reactive({
  nick_name: u0?.nick_name ?? '',
  job_title: u0?.job_title ?? '',
  phone: u0?.phone ?? '',
  github: u0?.github ?? ''
})

/** 行内编辑即时保存（字段 change 触发，全字段幂等 PATCH；成功静默，失败通知） */
async function saveProfile(): Promise<void> {
  if (store.accountBusy) return
  try {
    await store.saveProfile({
      nick_name: profileForm.nick_name.trim(),
      job_title: profileForm.job_title.trim(),
      phone: profileForm.phone.trim(),
      github: profileForm.github.trim()
    })
  } catch (err: unknown) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '保存失败，请稍后重试')
  }
}

// ── 退出登录（两段式确认，防误触）：成功后切往登录遮挡页 ─────
const confirmingLogout = ref(false)

async function logout(): Promise<void> {
  if (!confirmingLogout.value) {
    confirmingLogout.value = true
    return
  }
  confirmingLogout.value = false
  try {
    await store.logoutAccount()
    pushNotice(shell, 'success', '已退出登录（本设备的评分归属保留在账号名下）')
    await openAuthRequiredSheet(shell, store)
  } catch (err: unknown) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '退出失败，请稍后重试')
  }
}

// ── 设备列表（真数据：服务端 clients 表） ─────────────────────
function platformIcon(platform: string): string {
  if (platform === 'darwin') return 'lucide:laptop'
  if (platform === 'ios') return 'lucide:smartphone'
  return 'lucide:monitor'
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

/** 已授权设备图标（握手上报的 platform 与服务端记录的取值并存） */
function gateIcon(platform: string): string {
  if (platform === 'darwin' || platform === 'macos') return 'lucide:laptop'
  if (platform === 'ios' || platform === 'iphone' || platform === 'ipad') return 'lucide:smartphone'
  return 'lucide:monitor'
}

// ── 数据与隐私（单开关并入账户页；评分行为不设限，开关只管数据是否上传分享） ──
// 状态与切换逻辑归 market store（consentGranted/setConsent）：账户页写、rate 出网闸读。
async function toggleConsent(value: boolean): Promise<void> {
  try {
    await store.setConsent(value)
    pushNotice(shell, 'success', value ? '已开启评分分享' : '已关闭评分分享，上传已停止')
  } catch (err: unknown) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '授权状态保存失败')
  }
}

// ── 允许接入（设备直连闸：总开关 + 已授权设备 + 附近设备发现 + 添加连接 + 手机连接） ──
// 状态经 daemon.connection 服务直调 device.* RPC；列表刷新由挂载拉取 +
// devgate.devices_changed 通知驱动（批准/移除/开关切换后 daemon 广播）。
interface GateDevice {
  id: string
  name: string
  platform: string
  approved_at: string
}
interface GateStatus {
  allowed: boolean
  devices: GateDevice[]
}
interface FoundDevice {
  instance: string
  host: string
  port: number
}

/** daemon 连接服务（消费侧仅声明所需形状；插件间禁止 import） */
const conn = useService<{
  readonly mode: 'local' | 'remote'
  readonly remoteUrl: string
  readonly state: string
  switchMode(mode: 'local' | 'remote'): void
  setRemoteUrl(url: string): void
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
  onNotification(method: string, cb: (params: unknown) => void): () => void
}>('daemon.connection')

const gateAllowed = ref(true)
const gateDevices = ref<GateDevice[]>([])
const scanning = ref(false)
const foundDevices = ref<FoundDevice[]>([])
const scanError = ref('')
let offGateNotify: (() => void) | null = null

async function refreshGate(): Promise<void> {
  try {
    const st = await conn.call<GateStatus>('device.status', {}, 10000)
    gateAllowed.value = st.allowed
    gateDevices.value = st.devices ?? []
  } catch {
    // daemon 未连接：保留现值，通知到达或重挂载时再刷
  }
}

async function toggleGate(): Promise<void> {
  try {
    await conn.call('device.allow.set', { allowed: !gateAllowed.value }, 10000)
    gateAllowed.value = !gateAllowed.value
    pushNotice(shell, 'success', gateAllowed.value ? '已允许其他设备接入' : '已停止允许其他设备接入')
  } catch (err) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '开关保存失败，请稍后重试')
  }
}

async function revokeDevice(dev: GateDevice): Promise<void> {
  try {
    await conn.call('device.revoke', { device_id: dev.id }, 10000)
    pushNotice(shell, 'success', `已移除「${dev.name}」，它将无法再访问这台 Mac`)
  } catch (err) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '移除设备失败，请稍后重试')
  }
}

async function scanDevices(): Promise<void> {
  if (scanning.value) return
  scanning.value = true
  scanError.value = ''
  try {
    const r = await conn.call<{ devices: FoundDevice[] }>('device.scan', {}, 15000)
    foundDevices.value = r.devices ?? []
  } catch {
    scanError.value = '扫描失败，请稍后重试'
  } finally {
    scanning.value = false
  }
}

/** 发现的设备 → 连接地址（daemon ws 端点） */
function deviceUrl(d: FoundDevice): string {
  return `ws://${d.host}:${d.port}/ws`
}

/** 附近设备行的说明文案：扫描中/失败/有发现/无发现 四态 */
const nearbyText = computed(() => {
  if (scanning.value) return '正在扫描同一网络中的其他 Mac…'
  if (scanError.value) return scanError.value
  if (foundDevices.value.length > 0) return '在同一网络中发现了这些设备'
  return '没有发现同一网络中的其他 Mac'
})

/** 行状态：当前整机工作台正连着该设备 = 已连接，否则离线 */
function deviceConnected(d: FoundDevice): boolean {
  return conn.mode === 'remote' && conn.remoteUrl === deviceUrl(d) && conn.state === 'connected'
}

/** 一键直连：保存地址并切换整机工作台到该设备 */
function connectDevice(d: FoundDevice): void {
  conn.setRemoteUrl(deviceUrl(d))
  conn.switchMode('remote')
  pushNotice(shell, 'success', `正在连接「${deviceLabel(d)}」…`)
}

/** 实例名（MindX@主机名）转显示名 */
function deviceLabel(d: FoundDevice): string {
  return d.instance.replace(/^MindX@/, '') || d.host
}

/** 打开添加连接 modal（手动输入地址，发现扫不到时的兜底入口） */
function openAddDevice(): void {
  if (shell.Overlay.has(MODAL_DEVICE_ADDRESS)) shell.Overlay.remove(MODAL_DEVICE_ADDRESS)
  shell.Overlay.add({ id: MODAL_DEVICE_ADDRESS, kind: 'modal', component: DeviceAddressModal })
}

onMounted(() => {
  void store.fetchAccount()
  void refreshGate()
  void scanDevices()
  offGateNotify = conn.onNotification('devgate.devices_changed', () => {
    void refreshGate()
  })
})

onBeforeUnmount(() => {
  offGateNotify?.()
  offGateNotify = null
})

// 登录态落定后拉设备列表；登出即清（store 内已清，此处兜底观察）
watch(
  () => store.account?.user,
  (u) => {
    if (u) void store.fetchDevices()
    else store.devices = []
  },
  { immediate: true }
)
</script>

<template>
  <div :class="$style.wrap">
    <p v-if="store.accountLoading && !store.account" class="mx-text-loading">正在获取账号状态…</p>
    <p v-else-if="store.accountError" :class="$style.error">{{ store.accountError }}</p>

    <!-- ══ 已登录：仿 Apple 账户布局 ══ -->
    <template v-else-if="user">
      <!-- 头部：居中头像 + 称呼 + 账号 ID -->
      <div :class="$style.header">
        <button
          type="button"
          :class="$style.avatarBox"
          :data-hover="avatarHover ? 'true' : 'false'"
          title="更换头像"
          @click="pickImage()"
          @dragover.prevent="avatarHover = true"
          @dragleave="avatarHover = false"
          @drop.prevent="onAvatarDrop($event)"
        >
          <img v-if="user.avatar_url" :class="$style.bigAvatar" :src="user.avatar_url" :alt="user.nick_name || user.username" />
          <span v-else :class="$style.bigAvatar">{{ (user.nick_name || user.username).charAt(0).toUpperCase() }}</span>
          <span :class="$style.avatarMask"><MxIcon name="lucide:camera" :size="16" /></span>
        </button>
        <span :class="$style.headerName">{{ user.nick_name || user.username }}</span>
        <span :class="$style.headerId">{{ user.username }}</span>
        <span v-if="tokenStale" :class="$style.staleBadge">登录已失效，请重新登录</span>
      </div>

      <!-- 个人信息分组：常驻行内编辑（只读态无信息量，自动保存下单界面即可） -->
      <div :class="$style.sectionTitle">个人信息</div>
      <div :class="$style.cardGroup">
        <div v-for="f in profileIdentityFields" :key="f.key" :class="$style.row">
          <span :class="$style.editLabel">{{ f.label }}</span>
          <input
            v-model="profileForm[f.key]"
            :class="$style.editInput"
            :type="f.type" :maxlength="f.max" :placeholder="f.placeholder"
            :disabled="store.accountBusy"
            @change="saveProfile"
          />
        </div>
      </div>

      <!-- 登录与安全分组：手机/GitHub（登录凭据与发布署名）；退出登录移至页面最底部（2026-10-11 定案） -->
      <div :class="$style.sectionTitle">登录与安全</div>
      <div :class="$style.cardGroup">
        <div v-for="f in profileSecurityFields" :key="f.key" :class="$style.row">
          <span :class="$style.editLabel">{{ f.label }}</span>
          <input
            v-model="profileForm[f.key]"
            :class="$style.editInput"
            :type="f.type" :maxlength="f.max" :placeholder="f.placeholder"
            :disabled="store.accountBusy"
            @change="saveProfile"
          />
        </div>
      </div>
      <p :class="$style.groupFooter">手机用于登录，验证码登录即将开通（当前仅记录不参与验证）；GitHub 在发布内容时自动嵌入对应的 Agent、Skill、Plugin、Team 包内。</p>

      <!-- 设备分组（用户定案 2026-10-11：登录记录与接入管理同一组；传入连接不分手机与电脑，
           手机链路与 Mac 直连同受「允许其他设备接入」总闸约束，无独立开关） -->
      <div :class="$style.sectionTitle">设备</div>
      <div :class="$style.cardGroup">
        <!-- 账号设备：服务端登录记录 -->
        <p v-if="store.devicesLoading" class="mx-text-loading">正在获取设备列表…</p>
        <p v-else-if="store.devices.length === 0" :class="$style.emptyDevices">暂无设备记录</p>
        <div v-for="dev in store.devices" :key="dev.client_id" :class="$style.row">
          <span :class="$style.rowIcon"><MxIcon :name="platformIcon(dev.platform)" :size="16" /></span>
          <span :class="$style.rowMain">
            <span :class="$style.rowTitle">{{ dev.device_name || '未命名设备' }}</span>
            <span :class="$style.rowSub">设备短码 {{ shortId(dev.client_id) }}<template v-if="dev.last_seen_at"> · 最近活跃 {{ new Date(dev.last_seen_at).toLocaleDateString() }}</template></span>
          </span>
          <span v-if="dev.is_current" :class="$style.currentBadge">本机</span>
        </div>

        <!-- 总开关：管手机、其他 Mac 等一切设备的接入请求 -->
        <div :class="$style.row">
          <span :class="$style.rowIcon"><MxIcon name="lucide:shield-check" :size="16" /></span>
          <span :class="$style.rowMain">
            <span :class="$style.rowTitle">允许其他设备接入</span>
            <span :class="$style.rowSub">开启后，手机或其他 Mac 可以请求连接这台 Mac，每次连接都需要你在此确认。关闭后将拒绝所有新设备的接入请求。</span>
          </span>
          <button
            class="mx-switch"
            role="switch"
            :aria-checked="gateAllowed"
            @click="toggleGate()"
          >
            <span class="mx-switch-thumb" />
          </button>
        </div>

        <!-- 已授权设备：批准过的设备可凭凭据重连，此处可移除 -->
        <div v-for="dev in gateDevices" :key="dev.id" :class="$style.row">
          <span :class="$style.rowIcon"><MxIcon :name="gateIcon(dev.platform)" :size="16" /></span>
          <span :class="$style.rowMain">
            <span :class="$style.rowTitle">{{ dev.name }}</span>
            <span :class="$style.rowSub">已授权<template v-if="dev.approved_at"> · {{ new Date(dev.approved_at).toLocaleDateString() }} 批准</template></span>
          </span>
          <button type="button" :class="$style.minorBtn" @click="revokeDevice(dev)">移除</button>
        </div>

        <!-- 附近设备：打开此页自动扫描（mDNS 尽力而为），发现即列出，无需手动触发 -->
        <div :class="$style.row">
          <span :class="$style.rowIcon"><MxIcon name="lucide:radar" :size="16" /></span>
          <span :class="$style.rowMain">
            <span :class="$style.rowTitle">附近的设备</span>
            <span :class="$style.rowSub">{{ nearbyText }}</span>
          </span>
        </div>
        <div v-for="d in foundDevices" :key="d.instance" :class="$style.row">
          <span :class="$style.rowIcon"><MxIcon name="lucide:laptop" :size="16" /></span>
          <span :class="$style.rowMain">
            <span :class="$style.rowTitle">{{ deviceLabel(d) }}</span>
            <span :class="[$style.rowSub, { [$style.connectedText]: deviceConnected(d) }]">{{ deviceConnected(d) ? '已连接' : '离线' }}</span>
          </span>
          <button v-if="!deviceConnected(d)" type="button" :class="$style.minorBtn" @click="connectDevice(d)">连接</button>
        </div>

        <!-- 添加连接：手动输入地址（发现扫不到时的兜底入口） -->
        <button type="button" :class="$style.row" @click="openAddDevice()">
          <span :class="$style.rowIcon"><MxIcon name="lucide:plus" :size="16" /></span>
          <span :class="$style.rowMain">
            <span :class="$style.rowTitle">添加连接…</span>
            <span :class="$style.rowSub">知道对方的地址？直接输入来建立连接</span>
          </span>
        </button>
      </div>
      <p :class="$style.groupFooter">登录记录仅用于标识身份；被批准的设备可以像本机一样使用这台 Mac 上的智能助手，随时可以在列表中移除。</p>

      <!-- 数据与隐私分组：单开关（评分行为不设限，开关只管评分数据是否上传分享） -->
      <div :class="$style.sectionTitle">数据与隐私</div>
      <div :class="$style.cardGroup">
        <div :class="$style.row">
          <span :class="$style.rowIcon"><MxIcon name="lucide:star" :size="16" /></span>
          <span :class="$style.rowMain">
            <span :class="$style.rowTitle">分享我的评分</span>
            <span :class="$style.rowSub">允许把你对团队、员工、技能、插件在日常使用时的进化评分共享至社区；关闭也能正常打分，只是评分不会上传。评价内容与对话记录始终保存在本机。</span>
          </span>
          <button
            class="mx-switch" role="switch" :aria-checked="store.consentGranted"
            @click="toggleConsent(!store.consentGranted)"
          >
            <span class="mx-switch-thumb" />
          </button>
        </div>
      </div>

      <!-- 退出登录：离开性操作放页面最底部（2026-10-11 定案），两段式确认防误触 -->
      <div :class="$style.cardGroup">
        <div :class="$style.logoutRow">
          <button type="button" :class="confirmingLogout ? $style.logoutBtnArmed : $style.logoutBtn" @click="logout">
            {{ confirmingLogout ? '再点一次确认退出' : '退出登录' }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style module>
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-4);
  /* width:100% 必须显式：父级（设置页）是 flex 列容器，auto margin 会令子项
   * 放弃 stretch 收缩到内容宽——收起态卡片因此缩成窄条 */
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: var(--mx-space-4) var(--mx-space-4) var(--mx-space-6);
}

.error {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-state-error);
}

/* ── 头部：居中头像 + 姓名 + 账号 ID ── */
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
  object-fit: cover;
}

/* 头像编辑盒：点击/拖拽换头像，hover 显相机蒙层 */
.avatarBox {
  position: relative;
  display: inline-flex;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
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

.headerName {
  font: var(--mx-font-heading);
  font-size: 20px;
  color: var(--mx-text);
}

.headerId {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.staleBadge {
  font: var(--mx-font-caption);
  color: var(--mx-state-error);
}

/* ── 行卡组（仿 iOS Inset List）：灰底 + 可见边框线勾出分组轮廓 ── */
.cardGroup {
  display: flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--mx-text) 14%, transparent);
  border-radius: 10px;
  background: var(--mx-bg-secondary);
  overflow: hidden;
}

/* 行卡（仿 iOS Inset List）：行间细分隔线自文本起点内缩（separatorInset），末行无线 */
.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
  width: 100%;
  padding: var(--mx-space-3) var(--mx-space-4);
  border: none;
  background: transparent;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.row::after {
  content: '';
  position: absolute;
  /* 内缩量 = 行左内边距 + 图标宽 28px + 间距，即从 rowMain 文本起点画到行尾 */
  left: calc(var(--mx-space-4) + 28px + var(--mx-space-3));
  right: 0;
  bottom: 0;
  height: 1px;
  transform: scaleY(0.5);
  background: color-mix(in srgb, var(--mx-text) 12%, transparent);
  pointer-events: none;
}

.row:not(:last-child)::after {
  content: '';
}

.row:last-child::after {
  display: none;
}

button.row:hover {
  background: color-mix(in srgb, var(--mx-text) 4%, transparent);
}

.rowIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  color: var(--mx-accent);
}

.rowMain {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.rowTitle {
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.rowSub {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rowChevron {
  color: var(--mx-text-tertiary);
}

.currentBadge {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  font: var(--mx-font-caption);
  color: var(--mx-accent);
  background: color-mix(in srgb, var(--mx-accent) 12%, transparent);
}

/* ── 退出登录 ── */
.logoutRow {
  padding: var(--mx-space-3) var(--mx-space-4);
}

.logoutBtn,
.logoutBtnArmed {
  width: 100%;
  padding: 6px 12px;
  border: none;
  border-radius: 8px;
  font: var(--mx-font-body);
  cursor: pointer;
}

.logoutBtn {
  background: transparent;
  color: var(--mx-state-error);
}

.logoutBtn:hover {
  background: color-mix(in srgb, var(--mx-state-error) 8%, transparent);
}

.logoutBtnArmed {
  background: var(--mx-state-error);
  color: #fff;
}

/* ── 分组标题 ── */
.sectionTitle {
  padding: 0 var(--mx-space-2);
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.emptyDevices {
  margin: 0;
  padding: var(--mx-space-3) var(--mx-space-4);
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

/* ── 允许接入组：行内小按钮（扫描/连接/移除）与状态徽标 ── */
.minorBtn {
  flex-shrink: 0;
  padding: 4px 12px;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--mx-accent) 12%, transparent);
  color: var(--mx-accent);
  font: var(--mx-font-caption);
  cursor: pointer;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.minorBtn:disabled {
  opacity: 0.5;
  cursor: default;
}

.minorBtn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--mx-accent) 20%, transparent);
}

.connectedText {
  color: var(--mx-state-success);
}

/* ── 行内编辑（iOS List 编辑行：左 label 右值，无输入框边框） ── */
.editLabel {
  flex-shrink: 0;
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.editInput {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  font: var(--mx-font-body);
  text-align: right;
  color: var(--mx-text);
}

.editInput::placeholder {
  color: var(--mx-text-tertiary);
}

.editInput:focus {
  outline: none;
}

/* 分组脚注（iOS List footer：分组外底部灰色小字） */
.groupFooter {
  margin: 0;
  padding: var(--mx-space-2) var(--mx-space-4) 0;
  font: var(--mx-font-caption);
  line-height: 1.5;
  color: var(--mx-text-tertiary);
}
</style>
