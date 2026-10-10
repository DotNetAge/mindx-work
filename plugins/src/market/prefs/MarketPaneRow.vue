<script setup lang="ts">
/**
 * 市场页（独立 Settings Tab）：mindx 市场 agent/skill/team/plugin 四类分发包货架，
 * 顶部胶囊切换，「来源」与货架同级（点击切换到来源卡片视图：源卡片按 tier 呈现
 * 固定文案——官方源/专用源，源头地址不外显；卡片占满全行，title+description 居左、
 * 「选用」按钮垂直居中靠右，当前连接的源显示绿色圆点；选用专用源未存邀请码时
 * 弹出邀请码对话框，已存则直接连接）。
 * 搜索框与分类过滤胶囊为全货架共用一组组件（随激活货架映射数据源；来源视图不显示；
 * 搜索走服务端 q，分类为已加载条目的前端过滤）。
 * 换源写 user.config（daemon 连通探测成功才激活并广播 market_changed，货架经 sourceEpoch 重置重拉）；
 * 插件货架安装经宿主桥下载落盘（installFromUrl + sha256 校验），覆盖/安装确认走壳 Overlay modal。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useShell } from '@mindx-work/ui-shell-vue'
import { useMarketStore, pkgDisplayName, type MarketPkg, type MarketSourceItem, AgentExistsError as AgentExistsErrorCls, SkillExistsError as SkillExistsErrorCls, TeamExistsError as TeamExistsErrorCls } from '../store'
import { pushNotice } from '../notice'
import InstallConfirmModal from '../overlays/InstallConfirmModal.vue'
import TeamConfirmModal from '../overlays/TeamConfirmModal.vue'
import AgentConfirmModal from '../overlays/AgentConfirmModal.vue'
import SkillConfirmModal from '../overlays/SkillConfirmModal.vue'
import InviteCodeModal from '../overlays/InviteCodeModal.vue'
import PublishModal from '../overlays/PublishModal.vue'
import SubmitModal from '../overlays/SubmitModal.vue'
import InboxModal from '../overlays/InboxModal.vue'
import RatingEntry from '../RatingEntry.vue'
import AccountSheet from '../overlays/AccountSheet.vue'
import { OVERLAY_CONFIRM, MODAL_TEAM_CONFIRM, MODAL_AGENT_CONFIRM, MODAL_SKILL_CONFIRM, MODAL_PAT_CONFIRM, MODAL_PUBLISH, MODAL_SUBMIT, MODAL_INBOX, SHEET_ACCOUNT } from '../ids'

type ShelfKey = 'agent' | 'skill' | 'team' | 'plugin' | 'source'

const store = useMarketStore()
const shell = useShell()

const shelves: Array<{ key: ShelfKey; label: string }> = [
  { key: 'agent', label: '成员' },
  { key: 'team', label: '团队' },
  { key: 'skill', label: '技能' },
  { key: 'plugin', label: '插件' },
  { key: 'source', label: '来源' },
]
const activeShelf = ref<ShelfKey>('agent')

// ── 共用搜索 + 分类过滤（全部货架共用同一组组件，按激活货架映射数据源） ──
/** 市场固定业务分类（与服务端 categories 种子同词汇表；未收录分类排在固定分类之后按字典序） */
const FIXED_DOMAINS = ['办公提效', '产品研发', '智能硬件', '工业', '内容创作', '数据分析', '市场营销', '财务', '经营管理']

/** 搜索词双向绑定：读写激活货架各自的搜索 state（服务端 q 防抖在各自 watch 内） */
const searchModel = computed({
  get: () =>
    activeShelf.value === 'agent' ? store.agentSearch
    : activeShelf.value === 'skill' ? store.skillSearch
    : activeShelf.value === 'team' ? store.teamSearch
    : store.pluginSearch,
  set: (v: string) => {
    if (activeShelf.value === 'agent') store.agentSearch = v
    else if (activeShelf.value === 'skill') store.skillSearch = v
    else if (activeShelf.value === 'team') store.teamSearch = v
    else store.pluginSearch = v
  },
})

const searchPlaceholder = computed(
  () =>
    ({
      agent: '搜索成员名称或描述',
      skill: '搜索技能名称或描述',
      team: '搜索团队名称或描述',
      plugin: '搜索插件名称或描述',
      source: '',
    })[activeShelf.value],
)

/** 激活货架的已加载条目（来源视图无货架条目，返回空数组） */
const shelfPackages = computed(
  () =>
    ({
      agent: store.agentPackages,
      skill: store.skillPackages,
      team: store.teamPackages,
      plugin: store.pluginPackages,
      source: [],
    })[activeShelf.value],
)

/** 分类胶囊集合：当前货架已加载条目的 category 去重（固定分类顺序在前，其余字典序） */
const shelfDomains = computed<string[]>(() => {
  const present = new Set<string>()
  for (const p of shelfPackages.value) {
    const c = (p.category || '').trim()
    if (c) present.add(c)
  }
  return [...FIXED_DOMAINS.filter((d) => present.has(d)), ...[...present].filter((d) => !FIXED_DOMAINS.includes(d)).sort()]
})

/** 分类过滤选中态（'' = 全部）；切换货架重置 */
const activeDomain = ref('')
watch(activeShelf, () => {
  activeDomain.value = ''
})

/** 分类过滤视图（前端本地过滤，作用于已加载条目） */
function domainFiltered(pkgs: MarketPkg[]): MarketPkg[] {
  return !activeDomain.value ? pkgs : pkgs.filter((p) => (p.category || '').trim() === activeDomain.value)
}

// ── 来源视图（来源是货架同级胶囊；源卡片按 tier 呈现消费者文案，源头地址不外显） ──
/** 正在切换选定的源 id（对应卡片按钮局部 loading） */
const savingSourceId = ref('')

/** 源卡片标题（tier → 固定文案；服务端 name 为内部标识不外显） */
function sourceTitle(s: MarketSourceItem): string {
  return s.tier === 'merchant' ? '专用源' : 'MindX 官方源'
}

/** 源卡片描述（tier → 固定文案；邀请码是商户访问令牌的消费者称呼） */
function sourceDesc(s: MarketSourceItem): string {
  return s.tier === 'merchant'
    ? '只为特定用户开放的专用源，需要获得专用邀请码'
    : '官方公开的资源市场，全部用户可用'
}

/** 卡片「选用」：官方源或已存邀请码的专用源直接换源（daemon 连通探测成功才激活）；
 * 专用源未存邀请码时弹出邀请码对话框 */
function onPickSource(s: MarketSourceItem): void {
  if (s.tier !== 'merchant' || store.patSet) {
    void selectSource(s.id)
    return
  }
  store.requestPatDialog(s.id)
  openOverlay(MODAL_PAT_CONFIRM, InviteCodeModal)
}

/** 换源写 user.config，daemon 重建客户端并广播（货架经 sourceEpoch 重置重拉） */
async function selectSource(sourceID: string): Promise<void> {
  savingSourceId.value = sourceID
  try {
    await store.setSource(sourceID)
    pushOk('已切换市场来源')
  } catch (err: unknown) {
    pushErr(err)
  } finally {
    savingSourceId.value = ''
  }
}

function pushErr(err: unknown): void {
  pushNotice(shell, 'error', err instanceof Error ? err.message : '操作失败')
}

// ── 发布 / 投递 / 收件箱（§3/§4）：身份门槛（未绑定 → 账号 Sheet）+ Overlay modal ──
/** 发布/审核等高价值动作的身份门槛：已绑定用户或已配置商户令牌（daemon 双通道） */
const canPublish = computed(() => store.account?.user != null || store.patSet)

/** 打开市场账号 Sheet（发布/投递/收件箱未绑定时的引导，复用评分入口同款） */
function openAccountSheet(): void {
  if (shell.Sheet.has(SHEET_ACCOUNT)) shell.Sheet.remove(SHEET_ACCOUNT)
  shell.Sheet.add({ id: SHEET_ACCOUNT, title: '市场账号', component: AccountSheet as never })
}

function onOpenPublish(): void {
  if (!canPublish.value) {
    openAccountSheet()
    return
  }
  store.requestPublishDialog(activeShelf.value === 'agent' || activeShelf.value === 'skill' || activeShelf.value === 'team' ? activeShelf.value : 'agent')
  openOverlay(MODAL_PUBLISH, PublishModal)
}

function onOpenInbox(): void {
  if (!canPublish.value) {
    openAccountSheet()
    return
  }
  store.requestInboxDialog(activeShelf.value === 'agent' || activeShelf.value === 'skill' || activeShelf.value === 'team' ? activeShelf.value : 'agent')
  openOverlay(MODAL_INBOX, InboxModal)
}

/** 卡片投递入口（§4 回流）：本地已装同名包才可投递进化版本；未绑定引导账号 Sheet */
function onSubmitEvolution(pkg: MarketPkg): void {
  if (!canPublish.value) {
    openAccountSheet()
    return
  }
  store.requestSubmitDialog(pkg)
  openOverlay(MODAL_SUBMIT, SubmitModal)
}

// ── 换源广播订阅 + 首刷 ──
let unwatch: (() => void) | null = null
onMounted(() => {
  unwatch = store.watchMarketChanged()
  void store.fetchSource()
  // 账号状态（评分入口的绑定判断依据）+ 货架懒加载：仅拉当前激活货架，其余切换时按 loaded 标记补拉
  void store.fetchAccount()
  void loadActive()
  // 分段指示器首帧定位（布局稳定后测量）
  void nextTick(() => syncIndicator(marketTabsRef.value))
})
onUnmounted(() => unwatch?.())

// ── 分段页签指示器（.mx-tabs 指示器位移经 JS 写 transform，与团队管理行同款） ──
const marketTabsRef = ref<HTMLElement | null>(null)

function syncIndicator(root: HTMLElement | null): void {
  if (!root) return
  const tab = root.querySelector<HTMLButtonElement>('button[aria-selected="true"]')
  const ind = root.querySelector<HTMLElement>(':scope > [data-indicator]')
  if (!tab || !ind) return
  ind.style.width = `${tab.offsetWidth}px`
  ind.style.transform = `translateX(${tab.offsetLeft - 4}px)`
}

watch(activeShelf, () => void nextTick(() => syncIndicator(marketTabsRef.value)))

/** 激活货架懒加载（loaded 标记防重复；换源重置后 force 触发；来源视图无货架不加载） */
function loadActive(): void {
  if (activeShelf.value === 'source') return
  if (activeShelf.value === 'agent') void store.loadAgentMarket()
  else if (activeShelf.value === 'skill') void store.loadSkillMarket()
  else if (activeShelf.value === 'team') void store.loadTeamMarket()
  else void store.loadPluginMarket()
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
  // 来源视图无货架数据；打开时刷新源清单与连接态
  if (key === 'source') {
    void store.fetchSource()
    activeShelf.value = key
    return
  }
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
  } else if (key === 'plugin' && (epochChanged || pluginEpochMiss.value || !store.pluginLoaded)) {
    void store.loadPluginMarket()
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
let pluginTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => store.pluginSearch,
  () => {
    clearTimeout(pluginTimer)
    pluginTimer = setTimeout(() => void store.loadPluginMarket(), 300)
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

// ── 插件货架（market.list kind=plugin）：安装确认弹层（复用 InstallConfirmModal） ──
function onInstallPlugin(pkg: (typeof store.pluginPackages)[number]): void {
  store.requestConfirm(pkg)
  openOverlay(OVERLAY_CONFIRM, InstallConfirmModal)
}

/** 包体积人性化展示（KB/MB 一位小数，Bytes 原样） */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
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
const pluginSentinel = ref<HTMLElement | null>(null)
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
watch(pluginSentinel, (el, _prev, onCleanup) => {
  if (!el) return
  const ob = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) void store.loadPluginMarketMore()
    },
    { rootMargin: '240px' },
  )
  ob.observe(el)
  onCleanup(() => ob.disconnect())
})
</script>

<template>
  <div :class="$style.wrap">
    <!-- ── 标题 ── -->
    <div :class="$style.head">
      <span :class="$style.title">市场</span>
    </div>

    <!-- ── 货架分段切换（与团队管理行同款 mx-tabs 分段控件，来源与货架同级） ── -->
    <div ref="marketTabsRef" class="mx-tabs" :class="$style.viewTabs">
      <span data-indicator aria-hidden="true" :class="$style.tabsIndicator" />
      <button
        v-for="s in shelves"
        :key="s.key"
        type="button"
        class="mx-tab"
        role="tab"
        :aria-selected="activeShelf === s.key ? 'true' : 'false'"
        @click="switchShelf(s.key)"
      >{{ s.label }}</button>
    </div>

    <!-- ── 共用搜索行 + 分类过滤胶囊（全部货架共用，随激活货架切换数据源；来源视图不显示） ── -->
    <template v-if="activeShelf !== 'source'">
      <div :class="$style.toolbar">
        <input v-model="searchModel" class="mx-input" :class="$style.search" :placeholder="searchPlaceholder" spellcheck="false" />
        <!-- 发布 / 收件箱（§3/§4）：身份门槛在 handler 内（未绑定 → 账号 Sheet） -->
        <button type="button" class="mx-btn" @click="onOpenPublish">发布</button>
        <button type="button" class="mx-btn" @click="onOpenInbox">收件箱</button>
      </div>
      <div v-if="shelfDomains.length > 0" :class="$style.domains">
        <button type="button" :class="$style.domainTag" :data-active="activeDomain === '' ? 'true' : 'false'" @click="activeDomain = ''">全部</button>
        <button
          v-for="d in shelfDomains"
          :key="d"
          type="button"
          :class="$style.domainTag"
          :data-active="activeDomain === d ? 'true' : 'false'"
          @click="activeDomain = activeDomain === d ? '' : d"
        >{{ d }}</button>
      </div>
    </template>

    <!-- ══════════ 成员货架 ══════════ -->
    <div v-show="activeShelf === 'agent'">
      <p v-if="store.agentWarning" :class="$style.hint">{{ store.agentWarning }}</p>
      <p v-if="store.agentError" :class="$style.error">{{ store.agentError }}</p>
      <p v-if="store.agentLoading && !store.agentLoaded" :class="[$style.hint, 'mx-text-loading']">正在加载成员货架…</p>
      <div v-for="pkg in domainFiltered(store.agentPackages)" v-show="!store.agentLoading || store.agentLoaded" :key="pkg.name" :class="$style.marketItem">
        <img v-if="pkg.icon" :class="$style.avatar" :src="pkg.icon" :alt="pkgDisplayName(pkg)" />
        <span v-else :class="$style.avatar">{{ pkgDisplayName(pkg).charAt(0).toUpperCase() }}</span>
        <div :class="$style.itemText">
          <div :class="$style.nameRow">
            <span :class="$style.itemName">{{ pkgDisplayName(pkg) }}</span>
            <span v-if="pkg.role" class="mx-tag" data-tone="info">{{ pkg.role }}</span>
            <span class="mx-tag" data-tone="neutral">{{ pkg.category || '未分类' }}</span>
          </div>
          <span :class="$style.itemVersion">{{ pkg.name }}</span>
          <RatingEntry :pkg="pkg" />
          <span v-if="pkg.derived_from" :class="$style.derivedFrom">进化自 {{ pkg.derived_from.name }}</span>
          <div v-if="(pkg.skills ?? []).length" :class="$style.tagRow">
            <span class="mx-tag" data-tone="warning">{{ (pkg.skills ?? []).length }} 项技能装备</span>
          </div>
          <span :class="$style.desc">{{ pkg.description || '暂无描述' }}</span>
        </div>
        <div :class="$style.actionCol">
          <button
            v-if="store.localNameSets.agent?.has(pkg.name)"
            type="button"
            class="mx-btn"
            :disabled="store.installingAgent === pkg.name"
            @click="onSubmitEvolution(pkg)"
          >投递</button>
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
      <p v-if="store.skillLoading && !store.skillLoaded" :class="[$style.hint, 'mx-text-loading']">正在加载技能货架…</p>
      <div v-for="pkg in domainFiltered(store.skillPackages)" :key="pkg.name" :class="$style.marketItem">
        <span :class="$style.avatar">{{ pkgDisplayName(pkg).charAt(0).toUpperCase() }}</span>
        <div :class="$style.itemText">
          <div :class="$style.nameRow">
            <span :class="$style.itemName">{{ pkg.skillNames?.[pkg.name] || pkgDisplayName(pkg) }}</span>
            <span v-if="pkg.version" class="mx-tag" data-tone="info">v{{ pkg.version }}</span>
            <span class="mx-tag" data-tone="neutral">{{ pkg.category || '未分类' }}</span>
          </div>
          <span :class="$style.itemVersion">{{ pkg.name }}</span>
          <RatingEntry :pkg="pkg" />
          <span v-if="pkg.derived_from" :class="$style.derivedFrom">进化自 {{ pkg.derived_from.name }}</span>
          <span :class="$style.desc">{{ pkg.description || '暂无描述' }}</span>
        </div>
        <div :class="$style.actionCol">
          <button
            v-if="store.localNameSets.skill?.has(pkg.name)"
            type="button"
            class="mx-btn"
            :disabled="store.installingSkill === pkg.name"
            @click="onSubmitEvolution(pkg)"
          >投递</button>
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
      <p v-if="store.teamMarketLoading && !store.teamMarketLoaded" :class="[$style.hint, 'mx-text-loading']">正在加载团队货架…</p>
      <div v-for="pkg in domainFiltered(store.teamPackages)" :key="pkg.name" :class="$style.marketItem">
        <img v-if="pkg.icon" :class="$style.avatar" :src="pkg.icon" :alt="pkgDisplayName(pkg)" />
        <span v-else :class="$style.avatar">{{ pkgDisplayName(pkg).charAt(0).toUpperCase() }}</span>
        <div :class="$style.itemText">
          <div :class="$style.nameRow">
            <span :class="$style.itemName">{{ pkgDisplayName(pkg) }}</span>
            <span class="mx-tag" data-tone="info">团队</span>
            <span class="mx-tag" data-tone="neutral">{{ pkg.category || '未分类' }}</span>
          </div>
          <span :class="$style.itemVersion">{{ pkg.name }}</span>
          <RatingEntry :pkg="pkg" />
          <span v-if="pkg.derived_from" :class="$style.derivedFrom">进化自 {{ pkg.derived_from.name }}</span>
          <div :class="$style.tagRow">
            <span class="mx-tag" data-tone="neutral">负责人 {{ pkg.leader || '—' }}</span>
            <span class="mx-tag" data-tone="neutral">{{ (pkg.members || []).length }} 名成员</span>
          </div>
          <span :class="$style.desc">{{ pkg.description || '暂无描述' }}</span>
        </div>
        <div :class="$style.actionCol">
          <button
            v-if="store.localNameSets.team?.has(pkg.name)"
            type="button"
            class="mx-btn"
            :disabled="store.installingTeam === pkg.name"
            @click="onSubmitEvolution(pkg)"
          >投递</button>
          <button type="button" class="mx-btn mx-btn--primary" :disabled="store.installingTeam === pkg.name" @click="onInstallTeam(pkg)">
            <span v-if="store.installingTeam === pkg.name" class="mx-text-loading">安装中…</span>
            <template v-else>安装</template>
          </button>
        </div>
      </div>
      <div ref="teamSentinel" :class="$style.sentinel">
        <span v-if="store.teamMarketLoadingMore" class="mx-text-loading">正在加载更多…</span>
        <span v-else-if="store.teamMarketDone && store.teamPackages.length > 0">已加载全部团队整包</span>
      </div>
      <p v-if="store.teamMarketLoaded && store.teamPackages.length === 0 && !store.teamMarketError" :class="$style.hint">
        团队货架暂无可安装的团队整包。
      </p>
    </div>

    <!-- ══════════ 插件货架（market.list kind=plugin；数据源统一走 daemon 市场服务） ══════════ -->
    <div v-show="activeShelf === 'plugin'">
      <p v-if="store.pluginError" :class="$style.error">{{ store.pluginError }}</p>
      <p v-else-if="store.pluginLoading && !store.pluginLoaded" :class="[$style.hint, 'mx-text-loading']">正在加载插件货架…</p>
      <div v-for="pkg in domainFiltered(store.pluginPackages)" :key="pkg.name" :class="$style.marketItem">
        <div :class="$style.itemText">
          <div :class="$style.nameRow">
            <span :class="$style.itemName">{{ pkgDisplayName(pkg) }}</span>
            <span class="mx-tag" data-tone="info">插件</span>
            <span v-if="pkg.version" class="mx-tag" data-tone="neutral">v{{ pkg.version }}</span>
          </div>
          <span :class="$style.itemVersion">{{ pkg.name }}</span>
          <RatingEntry :pkg="pkg" />
          <span v-if="pkg.derived_from" :class="$style.derivedFrom">进化自 {{ pkg.derived_from.name }}</span>
          <div :class="$style.tagRow">
            <span v-if="pkg.author" class="mx-tag" data-tone="neutral">{{ pkg.author }}</span>
            <span v-if="pkg.license" class="mx-tag" data-tone="neutral">{{ pkg.license }}</span>
            <span v-if="pkg.size" class="mx-tag" data-tone="neutral">{{ formatSize(pkg.size) }}</span>
          </div>
          <span :class="$style.desc">{{ pkg.description || '暂无描述' }}</span>
        </div>
        <button
          type="button"
          class="mx-btn"
          :disabled="store.installedPluginIds.has(pkg.name)"
          @click="onInstallPlugin(pkg)"
        >
          {{ store.installedPluginIds.has(pkg.name) ? '已安装' : '安装' }}
        </button>
      </div>
      <div ref="pluginSentinel" :class="$style.sentinel">
        <span v-if="store.pluginLoadingMore" class="mx-text-loading">正在加载更多…</span>
        <span v-else-if="store.pluginDone && store.pluginPackages.length > 0">已加载全部插件</span>
      </div>
      <p v-if="store.pluginLoaded && store.pluginPackages.length === 0 && !store.pluginError" :class="$style.hint">
        插件市场暂无可安装的插件。
      </p>
      <p v-if="!store.hasBridge" :class="$style.hint">当前环境不支持安装插件（需要应用宿主）。</p>
    </div>

    <!-- ── 来源卡片视图（tier → 固定文案，地址不外显；全行卡片，绿点 = 当前连接） ── -->
    <template v-if="activeShelf === 'source'">
      <p v-if="store.sourcesLoading" class="mx-text-loading">正在加载可用源…</p>
      <p v-else-if="store.sourcesError" :class="$style.error">{{ store.sourcesError }}</p>
      <template v-else>
        <div :class="$style.sourceList">
          <div
            v-for="s in store.sources"
            :key="s.id"
            :class="$style.sourceCard"
            :data-selected="s.selected ? 'true' : 'false'"
          >
            <span v-if="s.selected" :class="$style.liveDot" aria-hidden="true"></span>
            <div :class="$style.cardBody">
              <span :class="$style.cardName">{{ sourceTitle(s) }}</span>
              <span :class="$style.cardDesc">{{ sourceDesc(s) }}</span>
            </div>
            <button
              type="button"
              class="mx-btn"
              :disabled="s.selected || savingSourceId === s.id"
              @click="onPickSource(s)"
            >
              <span v-if="savingSourceId === s.id" class="mx-text-loading">切换中…</span>
              <template v-else>{{ s.selected ? '已连接' : '选用' }}</template>
            </button>
          </div>
        </div>
      </template>
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

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.title {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

/* 分段页签指示器：与团队管理行同款（JS 写 width/transform，位移补偿容器 padding 4） */
.tabsIndicator {
  position: absolute;
  inset: 4px auto 4px 4px;
  box-sizing: border-box;
  border: 0.5px solid var(--mx-border-strong);
  border-radius: 8px;
  background: var(--mx-bg-elevated);
  transition:
    transform 180ms ease,
    width 180ms ease;
  pointer-events: none;
}

/* 分段容器：各档按内容排布（不占满行宽），底部保留与货架区的分隔线 */
.viewTabs {
  flex: none;
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
  border-bottom: none;
  padding-bottom: 0;
  margin-bottom: var(--mx-space-2);
}

.viewTabs :global(.mx-tab) {
  white-space: nowrap;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  margin-bottom: var(--mx-space-2);
}

.search {
  flex: 1;
  min-width: 0;
}

/* 分类过滤胶囊行（共用）：小号 check-tag 风格，选中语义对齐货架胶囊 */
.domains {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mx-space-1);
  margin-bottom: var(--mx-space-2);
}

.domainTag {
  padding: 2px 10px;
  border: 1px solid var(--mx-border-l4);
  border-radius: 999px;
  background: transparent;
  color: var(--mx-text-secondary);
  font: var(--mx-font-caption);
  cursor: pointer;
  transition:
    background-color var(--mx-duration-fast) var(--mx-ease-standard),
    border-color var(--mx-duration-fast) var(--mx-ease-standard),
    color var(--mx-duration-fast) var(--mx-ease-standard);
}

.domainTag:hover {
  color: var(--mx-text);
  background: var(--mx-hover);
}

.domainTag[data-active='true'] {
  border-color: color-mix(in srgb, var(--mx-accent) 35%, transparent);
  background: color-mix(in srgb, var(--mx-accent) 14%, transparent);
  color: var(--mx-accent);
  font-weight: 600;
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

/* 衍生谱系小字（§4）：卡片「进化自 XXX」（原创不透出，字段由服务端下发） */
.derivedFrom {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

/* 卡片操作列：投递（次级）+ 主动作纵排，与 itemText 顶对齐 */
.actionCol {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--mx-space-2);
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

/* ── 来源卡片视图（单列全行卡片：信息居左，选用按钮垂直居中靠右） ── */
.sourceList {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
}

.sourceCard {
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
  padding: var(--mx-space-3) var(--mx-space-4);
  border: 1px solid var(--mx-border-l4);
  border-radius: var(--mx-radius-md, 6px);
}

.sourceCard[data-selected='true'] {
  border-color: color-mix(in srgb, var(--mx-accent) 45%, transparent);
  background: color-mix(in srgb, var(--mx-accent) 8%, transparent);
}

/* 当前连接的源：绿色小圆点 */
.liveDot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--mx-success);
}

.cardBody {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  flex: 1;
  min-width: 0;
}

.cardName {
  font: var(--mx-font-body);
  font-weight: 600;
  color: var(--mx-text);
}

.cardDesc {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}
</style>
