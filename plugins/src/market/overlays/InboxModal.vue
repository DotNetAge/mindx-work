<script setup lang="ts">
/**
 * 包主收件箱 modal（§4，纯内容组件：卡片壳由 Overlay 容器提供）。
 * 两步流程：选本地包（本地包主身份的近似——先到先得纪律下 owner 通常即本地
 * 创建者）→ market.submissions.list 拉投递列表；采纳（服务端代转正式发布管线）
 * 或拒绝。重复决策 409 报错原样提示；非包主 403 同样原样透出。
 */
import { computed, ref, watch } from 'vue'
import { useShell } from '@mindx-work/ui-shell-vue'
import { useMarketStore, type MarketSubmissionItem } from '../store'
import { pushNotice } from '../notice'

const store = useMarketStore()
const shell = useShell()

/** 步骤：select = 选包；list = 收件箱列表 */
const step = ref<'select' | 'list'>('select')
const activeKind = ref<'agent' | 'skill' | 'team'>('agent')
const selectedName = ref('')

const items = ref<MarketSubmissionItem[]>([])
const loading = ref(false)
const listError = ref('')
/** 正在决策的投递 id（按钮防重） */
const decidingId = ref(0)

const visible = computed(() => store.inboxTarget !== null)

const localItems = computed(() => store.localPackages.filter((p) => p.kind === activeKind.value))

const kindLabels: Record<string, string> = { agent: '成员', skill: '技能', team: '团队' }

const statusLabels: Record<string, string> = { pending: '待审核', accepted: '已采纳', rejected: '已拒绝' }

watch(visible, (v) => {
  if (!v) return
  step.value = 'select'
  activeKind.value = (store.inboxTarget?.kind as 'agent' | 'skill' | 'team') || 'agent'
  selectedName.value = ''
  items.value = []
  listError.value = ''
  void store.fetchLocalPackages()
})

function choose(name: string): void {
  if (loading.value) return
  selectedName.value = name
  step.value = 'list'
  void load()
}

async function load(): Promise<void> {
  loading.value = true
  listError.value = ''
  try {
    items.value = await store.listSubmissions(activeKind.value, selectedName.value)
  } catch (err: unknown) {
    listError.value = err instanceof Error ? err.message : '收件箱拉取失败'
  } finally {
    loading.value = false
  }
}

/** 采纳：服务端代转正式发布管线；拒绝：仅标记状态。重复决策 409 原样提示 */
function decide(item: MarketSubmissionItem, accept: boolean): void {
  if (decidingId.value !== 0) return
  decidingId.value = item.id
  void store
    .decideSubmission(activeKind.value, selectedName.value, item.id, accept)
    .then((res) => {
      if (accept) {
        pushNotice(shell, 'success', `已采纳 v${res.version ?? item.version} 并发布为新版本`)
      } else {
        pushNotice(shell, 'success', '已拒绝该投递')
      }
      void load()
    })
    .catch((err: unknown) => {
      pushNotice(shell, 'error', err instanceof Error ? err.message : '审核失败')
    })
    .finally(() => {
      decidingId.value = 0
    })
}

function back(): void {
  step.value = 'select'
  items.value = []
  listError.value = ''
}
</script>

<template>
  <div v-if="visible" :class="$style.body">
    <!-- ── 步骤 1：选择自己名下的包 ── -->
    <template v-if="step === 'select'">
      <span :class="$style.title">收到的投递</span>
      <p :class="$style.desc">选择你发布的包，查看其他用户投递的进化版本。</p>

      <div class="mx-tabs" :class="$style.kindTabs">
        <span data-indicator aria-hidden="true" :class="$style.tabsIndicator" />
        <button
          v-for="k in ['agent', 'skill', 'team']"
          :key="k"
          type="button"
          class="mx-tab"
          role="tab"
          :aria-selected="activeKind === k ? 'true' : 'false'"
          @click="activeKind = k as 'agent' | 'skill' | 'team'"
        >{{ kindLabels[k] }}</button>
      </div>

      <div :class="$style.localList">
        <button
          v-for="item in localItems"
          :key="`${item.kind}/${item.name}`"
          type="button"
          :class="$style.localItem"
          @click="choose(item.name)"
        >
          <span :class="$style.localName">{{ item.name }}</span>
          <span :class="$style.localKind">{{ kindLabels[item.kind] }}</span>
        </button>
        <p v-if="localItems.length === 0" :class="$style.hint">本地暂无你名下的{{ kindLabels[activeKind] }}包。</p>
      </div>

      <div :class="$style.actions">
        <button type="button" class="mx-btn" @click="store.cancelInboxDialog()">关闭</button>
      </div>
    </template>

    <!-- ── 步骤 2：投递列表 ── -->
    <template v-else>
      <div :class="$style.listHead">
        <span :class="$style.title">「{{ selectedName }}」的投递</span>
        <button type="button" class="mx-btn" :disabled="decidingId !== 0 || loading" @click="back">换一个包</button>
      </div>

      <p v-if="loading" class="mx-text-loading">正在拉取收件箱…</p>
      <p v-else-if="listError" :class="$style.error">{{ listError }}</p>

      <div v-else-if="items.length > 0" :class="$style.subList">
        <div v-for="item in items" :key="item.id" :class="$style.subItem" :data-status="item.status">
          <div :class="$style.subText">
            <div :class="$style.subHead">
              <span :class="$style.subLogin">{{ item.from_login || `用户#${item.from_user_id}` }}</span>
              <span :class="$style.subVersion">v{{ item.version }}</span>
              <span class="mx-tag" data-tone="neutral">{{ statusLabels[item.status] || item.status }}</span>
            </div>
            <span :class="$style.subNote">{{ item.note || '（无附言）' }}</span>
            <span :class="$style.subMeta">{{ item.created_at }} · sha256 {{ item.sha256.slice(0, 12) }}…</span>
          </div>
          <div v-if="item.status === 'pending'" :class="$style.subActions">
            <button type="button" class="mx-btn mx-btn--primary" :disabled="decidingId !== 0" @click="decide(item, true)">
              <span v-if="decidingId === item.id" class="mx-text-loading">处理中…</span>
              <template v-else>采纳</template>
            </button>
            <button type="button" class="mx-btn" :disabled="decidingId !== 0" @click="decide(item, false)">拒绝</button>
          </div>
        </div>
      </div>
      <p v-else-if="!loading" :class="$style.hint">还没有收到投递。</p>
    </template>
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
}

.listHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
}

.kindTabs {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0;
  padding: 4px;
  border: 1px solid var(--mx-border-l4);
  border-radius: 10px;
}

.tabsIndicator {
  position: absolute;
  inset: 4px auto 4px 4px;
  box-sizing: border-box;
  border-radius: 7px;
  background: var(--mx-bg-elevated);
  transition:
    transform 180ms ease,
    width 180ms ease;
  pointer-events: none;
}

.localList {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  max-height: 280px;
  overflow-y: auto;
}

.localItem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.localItem:hover:not(:disabled) {
  background: var(--mx-hover);
}

.localName {
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.localKind {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.subList {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  max-height: 340px;
  overflow-y: auto;
}

.subItem {
  display: flex;
  align-items: flex-start;
  gap: var(--mx-space-3);
  padding: var(--mx-space-2) var(--mx-space-3);
  border: 1px solid var(--mx-border-l4);
  border-radius: 6px;
}

.subItem[data-status='accepted'],
.subItem[data-status='rejected'] {
  opacity: 0.65;
}

.subText {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.subHead {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  flex-wrap: wrap;
}

.subLogin {
  font: var(--mx-font-body);
  font-weight: 600;
  color: var(--mx-text);
}

.subVersion {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  font-variant-numeric: tabular-nums;
}

.subNote {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  word-break: break-all;
}

.subMeta {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.subActions {
  display: flex;
  gap: var(--mx-space-2);
  flex: none;
}

.hint {
  margin: 0;
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
}

.error {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-state-error);
  word-break: break-all;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
}
</style>
