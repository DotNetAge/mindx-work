<script setup lang="ts">
/**
 * 市场页（独立 Settings Tab）：mindx 市场 agent/skill/team 三类分发包货架 + 插件市场，
 * 顶部胶囊切换，标题右侧市场源信息与换源入口。
 * 数据归 market store（成员/技能/团队货架均服务端分页 + 服务端 q 搜索）；
 * 换源写 user.config（daemon 重建客户端并广播 market_changed，货架经 sourceEpoch 重置重拉）；
 * 插件市场走主进程桥（bridge().market()/install），覆盖/安装确认走壳 Overlay modal。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'
import { useMarketStore, pkgDisplayName, AgentExistsError as AgentExistsErrorCls, SkillExistsError as SkillExistsErrorCls, TeamExistsError as TeamExistsErrorCls } from '../store'
import { pushNotice } from '../notice'
import InstallConfirmModal from '../overlays/InstallConfirmModal.vue'
import TeamConfirmModal from '../overlays/TeamConfirmModal.vue'
import AgentConfirmModal from '../overlays/AgentConfirmModal.vue'
import SkillConfirmModal from '../overlays/SkillConfirmModal.vue'
import { OVERLAY_CONFIRM, MODAL_TEAM_CONFIRM, MODAL_AGENT_CONFIRM, MODAL_SKILL_CONFIRM } from '../ids'

type ShelfKey = 'agent' | 'skill' | 'team' | 'plugin'

const store = useMarketStore()
const shell = useShell()

const shelves: Array<{ key: ShelfKey; label: string }> = [
  { key: 'agent', label: '成员' },
  { key: 'team', label: '团队' },
  { key: 'skill', label: '技能' },
  { key: 'plugin', label: '插件' },
]
const activeShelf = ref<ShelfKey>('agent')

// ── 市场源（源列表选择；商户源需访问令牌解锁） ──
const sourcePanelOpen = ref(false)
const savingSource = ref(false)
/** 选中源 id（空串 = 官方 Default） */
const selectedSourceId = ref('')
const patInput = ref('')
const savingPat = ref(false)

const sourceLabel = computed(() => {
  const selected = store.sources.find((s) => s.selected)
  if (selected) return selected.name
  return String(store.sources.find((s) => s.id === '1')?.name || '官方市场')
})

function openSourcePanel() {
  selectedSourceId.value = store.sources.find((s) => s.selected)?.id ?? ''
  sourcePanelOpen.value = true
}

async function saveSource(): Promise<void> {
  savingSource.value = true
  try {
    await store.setSource(selectedSourceId.value)
    sourcePanelOpen.value = false
  } catch (err: unknown) {
    pushErr(err)
  } finally {
    savingSource.value = false
  }
}

async function savePat(): Promise<void> {
  savingPat.value = true
  try {
    await store.setPAT(patInput.value.trim())
    patInput.value = ''
  } catch (err: unknown) {
    pushErr(err)
  } finally {
    savingPat.value = false
  }
}

function pushErr(err: unknown): void {
  pushNotice(shell, 'error', err instanceof Error ? err.message : '操作失败')
}

// ── 换源广播订阅 + 首刷 ──
let unwatch: (() => void) | null = null
onMounted(() => {
  unwatch = store.watchMarketChanged()
  void store.fetchSource()
  // 货架懒加载：仅拉当前激活货架，其余切换时按 loaded 标记补拉
  void loadActive()
})
onUnmounted(() => unwatch?.())

/** 激活货架懒加载（loaded 标记防重复；换源重置后 force 触发） */
function loadActive(): void {
  if (activeShelf.value === 'agent') void store.loadAgentMarket()
  else if (activeShelf.value === 'skill') void store.loadSkillMarket()
  else if (activeShelf.value === 'team') void store.loadTeamMarket()
  else void store.refreshMarket()
}

// 换源广播：当前激活货架立即重拉（其余货架切换时按 epoch 感知重拉）
watch(
  () => store.sourceEpoch,
  () => {
    agentEpochMiss.value = true
    skillEpochMiss.value = true
    teamEpochMiss.value = true
    pluginEpochMiss.value = true
    loadActive()
  },
)

/** 货架切换时的换源感知：上次激活后源变过则重拉 */
const agentEpochMiss = ref(false)
const skillEpochMiss = ref(false)
const teamEpochMiss = ref(false)
const pluginEpochMiss = ref(false)
let lastEpochSeen = 0

function switchShelf(key: ShelfKey): void {
  const epochChanged = store.sourceEpoch !== lastEpochSeen
  lastEpochSeen = store.sourceEpoch
  if (key === 'agent' && (epochChanged || agentEpochMiss.value || !store.agentLoaded)) {
    void store.loadAgentMarket()
    agentEpochMiss.value = false
  } else if (key === 'skill' && (epochChanged || skillEpochMiss.value || !store.skillLoaded)) {
    void store.loadSkillMarket()
    skillEpochMiss.value = false
  } else if (key === 'team' && (epochChanged || teamEpochMiss.value || !store.teamMarketLoaded)) {
    void store.loadTeamMarket()
    teamEpochMiss.value = false
  } else if (key === 'plugin' && (epochChanged || pluginEpochMiss.value || store.market.length === 0)) {
    void store.refreshMarket()
    pluginEpochMiss.value = false
  }
  activeShelf.value = key
}

// 搜索防抖 300ms：服务端 q 触发重置加载
let agentTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => store.agentSearch,
  () => {
    clearTimeout(agentTimer)
    agentTimer = setTimeout(() => void store.loadAgentMarket(), 300)
  },
)
let skillTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => store.skillSearch,
  () => {
    clearTimeout(skillTimer)
    skillTimer = setTimeout(() => void store.loadSkillMarket(), 300)
  },
)
let teamTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => store.teamSearch,
  () => {
    clearTimeout(teamTimer)
    teamTimer = setTimeout(() => void store.loadTeamMarket(), 300)
  },
)

// ── 成员货架：招募 / 散伙（覆盖确认走 Overlay modal） ──
function onRecruit(pkg: (typeof store.agentPackages)[number]): void {
  void store
    .recruitAgent(pkg)
    .then(() => {
      void store.loadAgentMarket()
    })
    .catch((err: unknown) => {
      if (err instanceof AgentExistsErrorCls) {
        const m = err.message.match(/已存在同名智能体\s*"([^"]+)"/)
        store.requestAgentConfirm(
          '同名冲突',
          `已存在同名智能体「${m?.[1] || pkg.name}」，是否覆盖？覆盖后原内容将被替换，不可恢复。`,
          '覆盖安装',
          `已覆盖安装「${pkgDisplayName(pkg)}」`,
          async () => {
            await store.installAgentPackage(pkg, true)
            void store.loadAgentMarket()
          },
        )
        openOverlay(MODAL_AGENT_CONFIRM, AgentConfirmModal)
        return
      }
      pushErr(err)
    })
}

function onAgentFire(pkg: (typeof store.agentPackages)[number]): void {
  void store
    .fireAgent(pkg.name)
    .then(() => {
      void store.loadAgentMarket()
    })
    .catch(pushErr)
}

// ── 技能货架：安装（覆盖确认走 Overlay modal） ──
function onInstallSkill(pkg: (typeof store.skillPackages)[number]): void {
  if (store.installedSkillNames.has(pkg.name)) {
    store.requestSkillConfirm(
      '同名技能冲突',
      `全局库已存在同名技能「${pkgDisplayName(pkg)}」，是否覆盖？覆盖后原技能内容将被替换，不可恢复。`,
      '覆盖安装',
      `已覆盖安装「${pkgDisplayName(pkg)}」`,
      async () => {
        await store.installSkillPackage(pkg, true)
        void store.loadSkillMarket()
      },
    )
    openOverlay(MODAL_SKILL_CONFIRM, SkillConfirmModal)
    return
  }
  void store
    .installSkillPackage(pkg)
    .then(() => {
      void store.loadSkillMarket()
    })
    .catch((err: unknown) => {
      if (err instanceof SkillExistsErrorCls) {
        const m = err.message.match(/已存在同名技能\s*"([^"]+)"/)
        store.requestSkillConfirm(
          '同名技能冲突',
          `全局库已存在同名技能「${m?.[1] || pkgDisplayName(pkg)}」，是否覆盖？覆盖后原技能内容将被替换，不可恢复。`,
          '覆盖安装',
          `已覆盖安装「${pkgDisplayName(pkg)}」`,
          async () => {
            await store.installSkillPackage(pkg, true)
            void store.loadSkillMarket()
          },
        )
        openOverlay(MODAL_SKILL_CONFIRM, SkillConfirmModal)
        return
      }
      pushErr(err)
    })
}

// ── 团队货架：整队安装（覆盖确认走 Overlay modal，复用 TeamConfirmModal） ──
function onInstallTeam(pkg: (typeof store.teamPackages)[number]): void {
  void store
    .installTeam(pkg)
    .then((result) => {
      const members = result.members?.length ?? 0
      pushOk(`已安装团队「${pkgDisplayName(pkg)}」${members > 0 ? `及 ${members} 名成员` : ''}`)
      void store.loadTeamMarket()
    })
    .catch((err: unknown) => {
      if (err instanceof TeamExistsErrorCls) {
        const m = err.message.match(/已存在同名(团队|智能体)\s*"([^"]+)"/)
        store.requestTeamConfirm(
          '同名冲突',
          `已存在同名${m?.[1] || '团队'}「${m?.[2] || pkg.name}」，是否覆盖？覆盖后原团队与同名成员内容将被替换，不可恢复。`,
          '覆盖安装',
          `已覆盖安装「${pkgDisplayName(pkg)}」`,
          async () => {
            await store.installTeamPackage(pkg, true)
            void store.loadTeamMarket()
          },
        )
        openOverlay(MODAL_TEAM_CONFIRM, TeamConfirmModal)
        return
      }
      pushErr(err)
    })
}

// ── 插件货架（主进程桥）：安装确认弹层（复用 InstallConfirmModal） ──
function hasInstallableVersion(entry: (typeof store.market)[number]): boolean {
  const record = store.installed.find((p) => p.id === entry.id)
  if (!record) return true
  return entry.versions.some((v) => !record.versions.includes(v.version))
}

function onInstallPlugin(entry: (typeof store.market)[number]): void {
  store.requestConfirm(entry)
  openOverlay(OVERLAY_CONFIRM, InstallConfirmModal)
}

// Overlay modal 互斥惯例：add 前先 remove 同 id
function openOverlay(id: string, component: unknown): void {
  if (shell.Overlay.has(id)) shell.Overlay.remove(id)
  shell.Overlay.add({ id, kind: 'modal', component: component as never })
}

function pushOk(text: string): void {
  pushNotice(shell, 'success', text)
}

// ── 无限滚动哨兵（行组件在壳层滚动区内，root 取视口；进入视口触发追加） ──
const agentSentinel = ref<HTMLElement | null>(null)
const skillSentinel = ref<HTMLElement | null>(null)
const teamSentinel = ref<HTMLElement | null>(null)
watch(agentSentinel, (el, _prev, onCleanup) => {
  if (!el) return
  const ob = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) void store.loadAgentMarketMore()
    },
    { rootMargin: '240px' },
  )
  ob.observe(el)
  onCleanup(() => ob.disconnect())
})
watch(skillSentinel, (el, _prev, onCleanup) => {
  if (!el) return
  const ob = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) void store.loadSkillMarketMore()
    },
    { rootMargin: '240px' },
  )
  ob.observe(el)
  onCleanup(() => ob.disconnect())
})
watch(teamSentinel, (el, _prev, onCleanup) => {
  if (!el) return
  const ob = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) void store.loadTeamMarketMore()
    },
    { rootMargin: '240px' },
  )
  ob.observe(el)
  onCleanup(() => ob.disconnect())
})
</script>

<template>
  <div :class="$style.wrap">
    <!-- ── 标题 + 市场源（右侧同行） ── -->
    <div :class="$style.head">
      <span :class="$style.title">市场</span>
      <button type="button" class="mx-btn" :class="$style.sourceBtn" :title="sourceLabel" @click="openSourcePanel">
        <MxIcon name="lucide:radio-tower" :size="16" />
        <span :class="$style.sourceName">{{ sourceLabel }}</span>
        <MxIcon name="lucide:chevron-down" :size="16" />
      </button>
    </div>

    <!-- ── 货架胶囊 ── -->
    <div :class="$style.caps">
      <button
        v-for="s in shelves"
        :key="s.key"
        type="button"
        :class="$style.cap"
        :data-active="activeShelf === s.key ? 'true' : 'false'"
        @click="switchShelf(s.key)"
      >{{ s.label }}</button>
    </div>

    <!-- ══════════ 成员货架 ══════════ -->
    <div v-show="activeShelf === 'agent'">
      <p v-if="store.agentWarning" :class="$style.hint">{{ store.agentWarning }}</p>
      <p v-if="store.agentError" :class="$style.error">{{ store.agentError }}</p>
      <div :class="$style.toolbar">
        <input v-model="store.agentSearch" class="mx-input" :class="$style.search" placeholder="搜索成员名称或描述" spellcheck="false" />
        <button type="button" class="mx-icon-btn" aria-label="刷新成员货架" :disabled="store.agentLoading" @click="store.loadAgentMarket()">
          <MxIcon name="lucide:refresh-cw" :size="16" />
        </button>
        <span :class="$style.count">
          {{ store.agentTotal > 0 ? `已加载 ${store.agentPackages.length} / 共 ${store.agentTotal}` : `${store.agentPackages.length}` }}
        </span>
      </div>
      <p v-if="store.agentLoading && !store.agentLoaded" :class="[$style.hint, 'mx-text-loading']">正在加载成员货架…</p>
      <div v-for="pkg in store.agentPackages" v-show="!store.agentLoading || store.agentLoaded" :key="pkg.name" :class="$style.marketItem">
        <img v-if="pkg.icon" :class="$style.avatar" :src="pkg.icon" :alt="pkgDisplayName(pkg)" />
        <span v-else :class="$style.avatar">{{ pkgDisplayName(pkg).charAt(0).toUpperCase() }}</span>
        <div :class="$style.itemText">
          <div :class="$style.nameRow">
            <span :class="$style.itemName">{{ pkgDisplayName(pkg) }}</span>
            <span v-if="pkg.role" class="mx-tag" data-tone="info">{{ pkg.role }}</span>
            <span class="mx-tag" data-tone="neutral">{{ pkg.category || '未分类' }}</span>
          </div>
          <span :class="$style.itemVersion">{{ pkg.name }}</span>
          <div v-if="(pkg.skills ?? []).length" :class="$style.tagRow">
            <span class="mx-tag" data-tone="warning">{{ (pkg.skills ?? []).length }} 项技能装备</span>
          </div>
          <span :class="$style.desc">{{ pkg.description || '暂无描述' }}</span>
        </div>
        <button
          type="button"
          class="mx-btn"
          :class="{ 'mx-btn--primary': !store.hiredNames.has(pkg.name) }"
          :disabled="store.installingAgent === pkg.name"
          @click="store.hiredNames.has(pkg.name) ? onAgentFire(pkg) : onRecruit(pkg)"
        >
          <span v-if="store.installingAgent === pkg.name" class="mx-text-loading">处理中…</span>
          <template v-else>{{ store.hiredNames.has(pkg.name) ? '散伙' : '招募' }}</template>
        </button>
      </div>
      <div ref="agentSentinel" :class="$style.sentinel">
        <span v-if="store.agentLoadingMore" class="mx-text-loading">正在加载更多…</span>
        <span v-else-if="store.agentDone && store.agentPackages.length > 0">已加载全部成员包</span>
      </div>
      <p v-if="store.agentLoaded && store.agentPackages.length === 0 && !store.agentError" :class="$style.hint">
        成员货架暂无可安装的智能体包。
      </p>
    </div>

    <!-- ══════════ 技能货架 ══════════ -->
    <div v-show="activeShelf === 'skill'">
      <p v-if="store.skillWarning" :class="$style.hint">{{ store.skillWarning }}</p>
      <p v-if="store.skillError" :class="$style.error">{{ store.skillError }}</p>
      <div :class="$style.toolbar">
        <input v-model="store.skillSearch" class="mx-input" :class="$style.search" placeholder="搜索技能名称或描述" spellcheck="false" />
        <button type="button" class="mx-icon-btn" aria-label="刷新技能货架" :disabled="store.skillLoading" @click="store.loadSkillMarket()">
          <MxIcon name="lucide:refresh-cw" :size="16" />
        </button>
        <span :class="$style.count">
          {{ store.skillTotal > 0 ? `已加载 ${store.skillPackages.length} / 共 ${store.skillTotal}` : `${store.skillPackages.length}` }}
        </span>
      </div>
      <p v-if="store.skillLoading && !store.skillLoaded" :class="[$style.hint, 'mx-text-loading']">正在加载技能货架…</p>
      <div v-for="pkg in store.skillPackages" :key="pkg.name" :class="$style.marketItem">
        <span :class="$style.avatar">{{ pkgDisplayName(pkg).charAt(0).toUpperCase() }}</span>
        <div :class="$style.itemText">
          <div :class="$style.nameRow">
            <span :class="$style.itemName">{{ pkg.skillNames?.[pkg.name] || pkgDisplayName(pkg) }}</span>
            <span v-if="pkg.version" class="mx-tag" data-tone="info">v{{ pkg.version }}</span>
            <span class="mx-tag" data-tone="neutral">{{ pkg.category || '未分类' }}</span>
          </div>
          <span :class="$style.itemVersion">{{ pkg.name }}</span>
          <span :class="$style.desc">{{ pkg.description || '暂无描述' }}</span>
        </div>
        <button
          type="button"
          class="mx-btn"
          :class="{ 'mx-btn--primary': !store.installedSkillNames.has(pkg.name) }"
          :disabled="store.installingSkill === pkg.name"
          @click="onInstallSkill(pkg)"
        >
          <span v-if="store.installingSkill === pkg.name" class="mx-text-loading">安装中…</span>
          <template v-else>{{ store.installedSkillNames.has(pkg.name) ? '覆盖安装' : '安装' }}</template>
        </button>
      </div>
      <div ref="skillSentinel" :class="$style.sentinel">
        <span v-if="store.skillLoadingMore" class="mx-text-loading">正在加载更多…</span>
        <span v-else-if="store.skillDone && store.skillPackages.length > 0">已加载全部技能包</span>
      </div>
      <p v-if="store.skillLoaded && store.skillPackages.length === 0 && !store.skillError" :class="$style.hint">
        技能货架暂无可安装的技能包。
      </p>
    </div>

    <!-- ══════════ 团队货架 ══════════ -->
    <div v-show="activeShelf === 'team'">
      <p v-if="store.teamMarketWarning" :class="$style.hint">{{ store.teamMarketWarning }}</p>
      <p v-if="store.teamMarketError" :class="$style.error">{{ store.teamMarketError }}</p>
      <div :class="$style.toolbar">
        <input v-model="store.teamSearch" class="mx-input" :class="$style.search" placeholder="搜索团队名称或描述" spellcheck="false" />
        <button type="button" class="mx-icon-btn" aria-label="刷新团队货架" :disabled="store.teamMarketLoading" @click="store.loadTeamMarket()">
          <MxIcon name="lucide:refresh-cw" :size="16" />
        </button>
        <span :class="$style.count">
          {{ store.teamMarketTotal > 0 ? `已加载 ${store.teamPackages.length} / 共 ${store.teamMarketTotal}` : `${store.teamPackages.length}` }}
        </span>
      </div>
      <p v-if="store.teamMarketLoading && !store.teamMarketLoaded" :class="[$style.hint, 'mx-text-loading']">正在加载团队货架…</p>
      <div v-for="pkg in store.teamPackages" :key="pkg.name" :class="$style.marketItem">
        <img v-if="pkg.icon" :class="$style.avatar" :src="pkg.icon" :alt="pkgDisplayName(pkg)" />
        <span v-else :class="$style.avatar">{{ pkgDisplayName(pkg).charAt(0).toUpperCase() }}</span>
        <div :class="$style.itemText">
          <div :class="$style.nameRow">
            <span :class="$style.itemName">{{ pkgDisplayName(pkg) }}</span>
            <span class="mx-tag" data-tone="info">团队</span>
            <span class="mx-tag" data-tone="neutral">{{ pkg.category || '未分类' }}</span>
          </div>
          <span :class="$style.itemVersion">{{ pkg.name }}</span>
          <div :class="$style.tagRow">
            <span class="mx-tag" data-tone="neutral">负责人 {{ pkg.leader || '—' }}</span>
            <span class="mx-tag" data-tone="neutral">{{ (pkg.members || []).length }} 名成员</span>
          </div>
          <span :class="$style.desc">{{ pkg.description || '暂无描述' }}</span>
        </div>
        <button type="button" class="mx-btn mx-btn--primary" :disabled="store.installingTeam === pkg.name" @click="onInstallTeam(pkg)">
          <span v-if="store.installingTeam === pkg.name" class="mx-text-loading">安装中…</span>
          <template v-else>安装</template>
        </button>
      </div>
      <div ref="teamSentinel" :class="$style.sentinel">
        <span v-if="store.teamMarketLoadingMore" class="mx-text-loading">正在加载更多…</span>
        <span v-else-if="store.teamMarketDone && store.teamPackages.length > 0">已加载全部团队整包</span>
      </div>
      <p v-if="store.teamMarketLoaded && store.teamPackages.length === 0 && !store.teamMarketError" :class="$style.hint">
        团队货架暂无可安装的团队整包。
      </p>
    </div>

    <!-- ══════════ 插件货架 ══════════ -->
    <div v-show="activeShelf === 'plugin'">
      <p v-if="store.marketError" :class="$style.error">{{ store.marketError }}</p>
      <div v-for="entry in store.market" :key="entry.id" :class="$style.marketItem">
        <div :class="$style.itemText">
          <span :class="$style.itemName">{{ entry.name }}</span>
          <span :class="$style.itemVersion">{{ entry.author }} · {{ entry.license }}</span>
          <span :class="$style.desc">{{ entry.description }}</span>
        </div>
        <button
          type="button"
          class="mx-btn"
          :disabled="store.busyId === entry.id || !hasInstallableVersion(entry)"
          @click="onInstallPlugin(entry)"
        >
          {{ !store.installed.some((p) => p.id === entry.id) ? '安装' : hasInstallableVersion(entry) ? '安装此版本' : '已安装' }}
        </button>
      </div>
      <p v-if="!store.hasBridge" :class="$style.hint">当前环境不支持插件市场（需要应用宿主）。</p>
    </div>

    <!-- ── 换源面板（自绘浮层：源列表单选，商户源需访问令牌解锁） ── -->
    <Teleport to="body">
      <div v-if="sourcePanelOpen" :class="$style.sourceMask" @click="sourcePanelOpen = false">
        <div :class="$style.sourcePanel" @click.stop>
          <span :class="$style.sourceTitle">更换市场源</span>
          <p v-if="store.sourcesLoading" class="mx-text-loading">正在加载可用源…</p>
          <p v-else-if="store.sourcesError" :class="$style.error">{{ store.sourcesError }}</p>
          <template v-else>
            <label
              v-for="s in store.sources"
              :key="s.id"
              :class="$style.sourceRow"
            >
              <input
                v-model="selectedSourceId"
                type="radio"
                name="market-source"
                :value="s.id"
                :disabled="s.tier === 'merchant' && !store.patSet"
              />
              <span :class="{ [$style.sourceActive]: selectedSourceId === s.id }">{{ s.name }}</span>
              <span v-if="s.tier === 'merchant'" class="mx-tag" data-tone="warning">商户</span>
              <span v-if="s.tier === 'merchant' && !store.patSet" :class="$style.locked">需访问令牌解锁</span>
            </label>
          </template>
          <div :class="$style.patField">
            <span :class="$style.patLabel">商户源访问令牌</span>
            <input
              v-model="patInput"
              type="password"
              class="mx-input"
              :placeholder="store.patSet ? '已配置访问令牌；粘贴新令牌可更新' : '粘贴市场网页签发的访问令牌（PAT）'"
              spellcheck="false"
            />
            <span :class="$style.patHint">令牌在市场网页登录后于「访问令牌」页签发，仅商户用户可用商户源。</span>
          </div>
          <div :class="$style.sourceActions">
            <button type="button" class="mx-btn" @click="sourcePanelOpen = false">取消</button>
            <button
              type="button"
              class="mx-btn"
              :disabled="!patInput.trim() || savingPat"
              @click="savePat"
            >
              <span v-if="savingPat" class="mx-text-loading">保存中…</span>
              <template v-else>保存令牌</template>
            </button>
            <button type="button" class="mx-btn mx-btn--primary" :disabled="savingSource" @click="saveSource">
              <span v-if="savingSource" class="mx-text-loading">保存中…</span>
              <template v-else>保存</template>
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style module>
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-4);
  padding: var(--mx-space-4) 0;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.title {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.sourceBtn {
  max-width: 60%;
}

.sourceName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.caps {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  border-bottom: 1px solid color-mix(in srgb, var(--mx-text) 10%, transparent);
  padding-bottom: var(--mx-space-2);
}

.cap {
  padding: 4px 14px;
  border: 1px solid transparent;
  border-radius: var(--mx-radius-md, 6px);
  background: transparent;
  color: var(--mx-text-secondary);
  font: var(--mx-font-body);
  cursor: pointer;
}

.cap:hover {
  color: var(--mx-text);
}

.cap[data-active='true'] {
  background: color-mix(in srgb, var(--mx-accent) 14%, transparent);
  border-color: color-mix(in srgb, var(--mx-accent) 35%, transparent);
  color: var(--mx-accent);
  font-weight: 600;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  margin-bottom: var(--mx-space-2);
}

.search {
  width: 220px;
}

.count {
  margin-left: auto;
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
  white-space: nowrap;
}

.marketItem {
  display: flex;
  align-items: flex-start;
  gap: var(--mx-space-3);
  padding: var(--mx-space-3) 0;
  border-bottom: 1px solid color-mix(in srgb, var(--mx-text) 8%, transparent);
}

.avatar {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--mx-accent) 14%, transparent);
  color: var(--mx-accent);
  font-weight: 700;
  object-fit: cover;
}

.itemText {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nameRow {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  flex-wrap: wrap;
}

.itemName {
  font: var(--mx-font-body);
  font-weight: 600;
  color: var(--mx-text);
}

.itemVersion {
  font: var(--mx-font-body);
  color: var(--mx-text-tertiary);
}

.tagRow {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  flex-wrap: wrap;
}

.desc {
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
}

.hint {
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
}

.error {
  font: var(--mx-font-body);
  color: var(--mx-danger, #d64545);
}

.sentinel {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 24px;
  padding: var(--mx-space-1) 0;
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
}

/* ── 换源浮层 ── */
.sourceMask {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, black 40%, transparent);
}

.sourcePanel {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
  width: min(460px, 92vw);
  padding: var(--mx-space-5);
  border-radius: var(--mx-radius-lg, 10px);
  background: var(--mx-bg-card, var(--mx-bg, #fff));
  border: 1px solid color-mix(in srgb, var(--mx-text) 15%, transparent);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}

.sourceTitle {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.sourceRow {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  cursor: pointer;
}

.sourceRow input:disabled + span {
  color: var(--mx-text-tertiary);
}

.sourceActive {
  color: var(--mx-accent);
  font-weight: 600;
}

.locked {
  font: var(--mx-font-body);
  color: var(--mx-text-tertiary);
}

.patField {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  padding-top: var(--mx-space-2);
  border-top: 1px solid color-mix(in srgb, var(--mx-text) 10%, transparent);
}

.patLabel {
  font: var(--mx-font-body);
  font-weight: 600;
  color: var(--mx-text);
}

.patHint {
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
}

.sourceActions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
}
</style>
