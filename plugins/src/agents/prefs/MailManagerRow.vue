<script setup lang="ts">
/**
 * 组织信箱行：跨机器派工与汇报的收发视图（agents 设置页第二行）。
 * 来信 = 已送达本机的信（daemon 留档，点开读正文并可直接回信）；
 * 去信 = 服务端对账视图（对方是否已取、回信数）。
 * 写信与回信都经 daemon（mail.send / mail.reply）：信先落服务端信箱拿全局
 * 编号与留底，再由 daemon 接力直连对方智能主机（不通则等对方上线拉取）。
 * 收件人下拉来自 mail.members；加载失败降级为手输名字。
 */
import { computed, onMounted, ref, useCssModule, watch, nextTick } from 'vue'
import { useShell } from '@mindx-work/ui-shell-vue'
import { useAgentsStore } from '../store'
import { pushNotice } from '../notice'

const store = useAgentsStore()
const shell = useShell()
const $style = useCssModule()

// ── 分段页签（来信 | 去信）：指示器位移经 JS 写 transform（AgentsManagerRow 同款） ──
const view = ref<'inbox' | 'sent'>('inbox')
const viewTabsRef = ref<HTMLElement | null>(null)

function syncIndicator(): void {
  const root = viewTabsRef.value
  if (!root) return
  const tab = root.querySelector<HTMLButtonElement>('button[aria-selected="true"]')
  const ind = root.querySelector<HTMLElement>(':scope > [data-indicator]')
  if (!tab || !ind) return
  ind.style.width = `${tab.offsetWidth}px`
  ind.style.transform = `translateX(${tab.offsetLeft - 4}px)`
}

watch(view, () => void nextTick(syncIndicator))
onMounted(() => {
  store.loadInbox().catch((err: unknown) => {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '来信加载失败，请检查与智能主机的连接')
  })
  store.loadSent().catch(() => {})
  // 收件人名片加载失败仅降级为手输名字，不阻断信箱浏览
  store.loadMailMembers().catch(() => {})
  void nextTick(syncIndicator)
})

// ── 来信：点击行展开正文 + 回信框 ──
const selectedUid = ref('')
const selectedMail = computed(() => store.inbox.find((m) => m.uid === selectedUid.value) || null)

function toggleMail(uid: string): void {
  selectedUid.value = selectedUid.value === uid ? '' : uid
  replyBody.value = ''
}

// ── 回信 ──
const replyBody = ref('')
const replying = ref(false)
const canReply = computed(() => Boolean(selectedMail.value) && Boolean(replyBody.value.trim()) && !replying.value)

async function submitReply(): Promise<void> {
  const mail = selectedMail.value
  if (!mail || !canReply.value) return
  replying.value = true
  try {
    const res = await store.replyMail(mail.uid, replyBody.value.trim())
    pushNotice(
      shell,
      'success',
      res.delivered_directly
        ? `已回信给「${mail.from_name}」，信已直送对方智能主机`
        : `已回信给「${mail.from_name}」，信已留在对方信箱，对方上线后自动收取`,
    )
    replyBody.value = ''
    selectedUid.value = ''
  } catch (err: unknown) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '回信失败')
  } finally {
    replying.value = false
  }
}

// ── 写信（行内表单） ──
const composeOpen = ref(false)
const composeTo = ref('')
const composeSubject = ref('')
const composeBody = ref('')
const sending = ref(false)
const canSend = computed(
  () =>
    Boolean(composeTo.value.trim()) &&
    Boolean(composeSubject.value.trim()) &&
    Boolean(composeBody.value.trim()) &&
    !sending.value,
)

function openCompose(): void {
  composeOpen.value = !composeOpen.value
  selectedUid.value = ''
  replyBody.value = ''
}

async function submitCompose(): Promise<void> {
  if (!canSend.value) return
  sending.value = true
  const to = composeTo.value.trim()
  try {
    const res = await store.sendMail(to, composeSubject.value.trim(), composeBody.value.trim())
    pushNotice(
      shell,
      'success',
      res.delivered_directly
        ? `已寄出给「${to}」，信已直送对方智能主机`
        : `已寄出给「${to}」，信已留在对方信箱，对方上线后自动收取`,
    )
    composeOpen.value = false
    composeTo.value = ''
    composeSubject.value = ''
    composeBody.value = ''
    view.value = 'sent'
  } catch (err: unknown) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '寄信失败')
  } finally {
    sending.value = false
  }
}

// ── 展示辅助 ──
/** 收件人候选：排除本机自己（服务端不接受自寄，选了也寄不出）。 */
const selectableMembers = computed(() =>
  store.mailMembers.filter((m) => m.persona_id !== store.mailMePersona),
)

function shortTime(iso: string): string {
  return (iso || '').replace('T', ' ').slice(0, 16)
}

function sentStatus(status: string): string {
  return status === 'delivered' ? '对方已取' : '已寄出（对方未取）'
}
</script>

<template>
  <div :class="$style.wrap">
    <!-- 节头：标题 + 说明 + 写信入口 -->
    <div :class="$style.sectionHead">
      <div :class="$style.headText">
        <span :class="$style.sectionTitle">组织信箱</span>
        <span :class="$style.sectionHint">给组织里的同事寄信安排工作或请求帮忙；对方办完会回信到这里</span>
      </div>
      <button type="button" class="mx-btn" data-variant="primary" :class="$style.composeBtn" @click="openCompose">
        {{ composeOpen ? '收起' : '写一封信' }}
      </button>
    </div>

    <!-- ── 写信表单（行内展开） ── -->
    <div v-if="composeOpen" :class="$style.compose">
      <select v-if="selectableMembers.length > 0" v-model="composeTo" class="mx-input" :class="$style.field">
        <option value="" disabled>选择收件人</option>
        <option v-for="m in selectableMembers" :key="m.persona_id" :value="m.display_name">
          {{ m.display_name }}{{ m.job_title ? `（${m.job_title}）` : '' }}
        </option>
      </select>
      <input v-else v-model="composeTo" class="mx-input" :class="$style.field" placeholder="手输名字" />
      <input v-model="composeSubject" class="mx-input" :class="$style.field" placeholder="主题" />
      <textarea v-model="composeBody" class="mx-input" :class="[$style.field, $style.bodyField]" rows="6" placeholder="信的正文：说清要做什么、干成什么样算成、材料在哪、什么时候要" />
      <div :class="$style.actions">
        <button type="button" class="mx-btn" data-variant="primary" :disabled="!canSend" @click="submitCompose">
          {{ sending ? '正在寄出…' : '寄出' }}
        </button>
      </div>
    </div>

    <!-- ── 「来信 | 去信」分段切换 ── -->
    <div :class="$style.tabsRow">
      <div ref="viewTabsRef" class="mx-tabs" :class="$style.viewTabs">
        <span data-indicator aria-hidden="true" :class="$style.tabsIndicator" />
        <button type="button" class="mx-tab" role="tab" :aria-selected="view === 'inbox' ? 'true' : 'false'" @click="view = 'inbox'">
          来信
        </button>
        <button type="button" class="mx-tab" role="tab" :aria-selected="view === 'sent' ? 'true' : 'false'" @click="view = 'sent'">
          去信
        </button>
      </div>
    </div>

    <!-- ── 来信清单 ── -->
    <template v-if="view === 'inbox'">
      <p v-if="store.inboxLoading && !store.inboxLoaded" :class="[$style.hint, 'mx-text-loading']">正在取信…</p>
      <div v-else-if="store.inbox.length > 0" :class="$style.list">
        <div v-for="m in store.inbox" :key="m.uid" :class="$style.mailItem">
          <button type="button" :class="$style.mailRow" @click="toggleMail(m.uid)">
            <span :class="$style.mailFrom">{{ m.from_name || '未知寄件人' }}</span>
            <span :class="$style.mailSubject">
              {{ m.subject }}
              <span v-if="m.in_reply_to" class="mx-tag" data-tone="neutral">回信</span>
            </span>
            <span :class="$style.mailTime">{{ shortTime(m.received_at) }}</span>
          </button>
          <div v-if="selectedMail && selectedMail.uid === m.uid" :class="$style.mailDetail">
            <pre :class="$style.mailBody">{{ m.body }}</pre>
            <div :class="$style.replyBlock">
              <textarea v-model="replyBody" class="mx-input" :class="[$style.field, $style.replyField]" rows="3" placeholder="回信内容：办到什么程度就说什么程度" />
              <div :class="$style.actions">
                <button type="button" class="mx-btn" data-variant="primary" :disabled="!canReply" @click="submitReply">
                  {{ replying ? '正在回信…' : '回信' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-else :class="$style.emptyBox">
        <p :class="$style.hint">收件箱暂时没有信</p>
      </div>
    </template>

    <!-- ── 去信清单（服务端对账） ── -->
    <template v-else>
      <p v-if="store.sentLoading && !store.sentLoaded" :class="[$style.hint, 'mx-text-loading']">正在读取去信…</p>
      <div v-else-if="store.sent.length > 0" :class="$style.list">
        <div v-for="m in store.sent" :key="m.uid" :class="$style.mailRow">
          <span :class="$style.mailSubject">
            {{ m.subject }}
            <span v-if="m.in_reply_to" class="mx-tag" data-tone="neutral">回信</span>
          </span>
          <span :class="$style.mailMeta">{{ sentStatus(m.status) }}</span>
          <span :class="$style.mailMeta">{{ m.reply_count > 0 ? `已收 ${m.reply_count} 封回信` : '暂无回信' }}</span>
          <span :class="$style.mailTime">{{ shortTime(m.created_at) }}</span>
        </div>
      </div>
      <div v-else :class="$style.emptyBox">
        <p :class="$style.hint">还没有寄出过信</p>
      </div>
    </template>
  </div>
</template>

<style module>
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
  padding: var(--mx-space-4) 0;
}

.sectionHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
}

.headText {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.sectionTitle {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.sectionHint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.composeBtn {
  flex: 0 0 auto;
}

/* 页签行：页签组独占一行且水平居中（AgentsManagerRow 同款） */
.tabsRow {
  display: flex;
  justify-content: center;
}

/* 写信表单：竖排字段，间距统一 */
.compose {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  padding: var(--mx-space-3);
  background: var(--mx-bg-surface);
  border: 0.5px solid var(--mx-separator);
  border-radius: var(--mx-radius-control);
}

.field {
  width: 100%;
  box-sizing: border-box;
}

.bodyField,
.replyField {
  resize: vertical;
  font: var(--mx-font-body);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
}

/* 信件清单：简单行式，无边框卡片（对齐节点样式的极简原则） */
.list {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.mailItem {
  display: flex;
  flex-direction: column;
}

.mailRow {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  width: 100%;
  box-sizing: border-box;
  padding: var(--mx-space-2) var(--mx-space-3);
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  font: var(--mx-font-body);
  color: var(--mx-text);
  text-align: left;
  cursor: pointer;
}

.mailRow:hover {
  background: var(--mx-bg-surface);
}

.mailFrom {
  flex: 0 0 auto;
  min-width: 72px;
  font-weight: 600;
  color: var(--mx-text);
}

.mailSubject {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--mx-text);
}

.mailMeta {
  flex: 0 0 auto;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.mailTime {
  flex: 0 0 auto;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

/* 展开的正文与回信区：左侧对齐正文缩进 */
.mailDetail {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  padding: 0 var(--mx-space-3) var(--mx-space-2) var(--mx-space-3);
}

.mailBody {
  margin: 0;
  padding: var(--mx-space-3);
  background: var(--mx-bg-surface);
  border-radius: var(--mx-radius-control);
  font: var(--mx-font-body);
  color: var(--mx-text);
  white-space: pre-wrap;
  word-break: break-word;
}

.replyBlock {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
}

.emptyBox {
  display: flex;
  justify-content: center;
  padding: var(--mx-space-5) 0;
}

.hint {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  text-align: center;
}
</style>
