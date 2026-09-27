<script setup lang="ts">
/**
 * 技能管理行："技能"设置页唯一自定义行，承载完整管理器（models 管理行先例）。
 * 双视图：本地（全局技能库，导出/修改/删除/许可证）+ 在线市场（懒加载，安装进全局库）。
 * 详情弹层为 FLIP 分段动效（ghost 卡片拉宽→拉高→到位即呈现），贴触发点的局部浮层
 * 由组件自绘（契约 §6：只收全局层，popover/sheet 归组件）；编辑/许可证/确认走壳 Overlay modal。
 * 注意壳 modal z 序低于本组件 Teleport 层——弹层内动作先硬关弹层再开 modal（避免层叠纠缠）。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, useCssModule, watch } from 'vue'
import type { Component } from 'vue'
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'
import { useSkillsStore, skillDisplayName, skillLocaleDesc, isThirdParty, SkillExistsError } from '../store'
import { pushNotice } from '../notice'
import { MODAL_SKILLS_CONFIRM, MODAL_SKILL_EDIT, MODAL_SKILL_LICENSE } from '../ids'
import { renderMarkdown } from '../markdown'
import type { MarketPackageInfo, SkillInfo } from '../types'
import ConfirmModal from '../overlays/ConfirmModal.vue'
import EditSkillModal from '../overlays/EditSkillModal.vue'
import LicenseModal from '../overlays/LicenseModal.vue'

const store = useSkillsStore()
const shell = useShell()
// script 内访问 CSS module 需显式取用（$style 仅为模板可用）
const $style = useCssModule()

onMounted(() => {
  store.loadSkills().catch((err: unknown) => {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '加载技能清单失败')
  })
})

/** modal 互斥惯例：add 前先 remove 同 id（契约 §6） */
function openModal(id: string, component: Component) {
  if (shell.Overlay.has(id)) shell.Overlay.remove(id)
  shell.Overlay.add({ id, kind: 'modal', component })
}

function openConfirm(): void {
  openModal(MODAL_SKILLS_CONFIRM, ConfirmModal)
}

// ── 视图切换：本地 / 市场（市场懒加载：首次切到才拉清单） ──
const view = ref<'local' | 'market'>('local')

watch(view, (v) => {
  if (v === 'market' && !store.marketLoaded && !store.marketLoading) {
    void onMarketRefresh()
  }
})

async function onMarketRefresh() {
  try {
    await store.loadMarket()
  } catch (err: unknown) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '市场清单加载失败')
  }
}

// ── 本地视图：搜索筛选 ──
const searchQuery = ref('')
const filteredSkills = computed<SkillInfo[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return store.skills
  return store.skills.filter((s) => {
    const hay = [s.name, skillDisplayName(s), skillLocaleDesc(s)].join(' ').toLowerCase()
    return hay.includes(q)
  })
})

// ── 本地卡片动作 ──

/** 导出为 .mindpkg（系统保存对话框） */
function onExport(skill: SkillInfo) {
  void store
    .exportSkill(skill)
    .then((text) => {
      if (text) pushNotice(shell, 'success', text)
    })
    .catch((err: unknown) => {
      pushNotice(shell, 'error', err instanceof Error ? `导出失败：${err.message}` : '导出失败')
    })
}

/** 打开 SKILL.md 编辑 modal */
function onEdit(skill: SkillInfo) {
  if (!store.openEdit(skill)) {
    pushNotice(shell, 'error', '该技能无文件系统路径，无法编辑')
    return
  }
  openModal(MODAL_SKILL_EDIT, EditSkillModal)
}

function onDelete(skill: SkillInfo) {
  store.requestRemove(skill)
  openConfirm()
}

function onLicense(skill: SkillInfo) {
  store.openLicense(skill.name, skill.license || '')
  openModal(MODAL_SKILL_LICENSE, LicenseModal)
}

/** 导入分发包（系统选择对话框 → skill.import；同名冲突走覆盖确认） */
async function onImport() {
  let path: string | null = null
  try {
    path = await store.pickImportPath()
  } catch (err: unknown) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '打开文件对话框失败')
    return
  }
  if (!path) return
  try {
    pushNotice(shell, 'success', await store.importPackage(path))
  } catch (err: unknown) {
    if (err instanceof SkillExistsError) {
      const m = err.message.match(/已存在同名技能\s*"([^"]+)"/)
      store.requestConfirm(
        '同名技能冲突',
        `全局库已存在同名技能「${m?.[1] || ''}」，是否覆盖？覆盖后原技能内容将被替换，不可恢复。`,
        '覆盖',
        '已覆盖安装',
        () => store.importPackage(path!, true),
      )
      openConfirm()
      return
    }
    pushNotice(shell, 'error', err instanceof Error ? `安装失败：${err.message}` : '安装失败')
  }
}

// ── 市场视图：搜索 + 分类筛选 ──
const marketSearch = ref('')
const marketDomain = ref('')

/** 市场技能包筛选（分类 + 搜索覆盖中文名/包名/描述） */
const filteredMarketPackages = computed<MarketPackageInfo[]>(() => {
  const q = marketSearch.value.trim().toLowerCase()
  return store.marketPackages.filter((p) => {
    if (marketDomain.value && (p.category || '').trim() !== marketDomain.value) return false
    if (!q) return true
    const hay = [p.name, store.marketDisplayName(p), p.description || ''].join(' ').toLowerCase()
    return hay.includes(q)
  })
})

/** 安装市场技能包（未安装直装；已安装或同名冲突走覆盖确认） */
function onInstall(pkg: MarketPackageInfo) {
  if (store.installedNames.has(pkg.name)) {
    store.requestOverwrite(pkg)
    openConfirm()
    return
  }
  void store
    .withInstalling(pkg, () => store.installMarket(pkg))
    .then((text) => {
      pushNotice(shell, 'success', text)
    })
    .catch((err: unknown) => {
      if (err instanceof SkillExistsError) {
        store.requestOverwrite(pkg)
        openConfirm()
        return
      }
      pushNotice(shell, 'error', err instanceof Error ? `安装失败：${err.message}` : '安装失败')
    })
}

// ── 详情弹层（本地 + 市场卡片共用）：FLIP 分段动效 + SKILL.md markdown 正文预览 ──
// 动效编排（只动 transform/opacity，GPU 合成零重排，不用 backdrop-filter）：
// 点击卡片 → ① 拉长左右至弹层宽度 → ② 拉长上下至弹层高度，到位即终结（弹层立即呈现，无淡入尾段）；
// 关闭时反向：先收上下 → 再收左右 → 落回格子。

interface ZoomTarget {
  kind: 'local' | 'market'
  /** 展示名 */
  title: string
  /** 技能/包原名 */
  name: string
  tagText: string
  tagTone: 'success' | 'info' | 'warning'
  description: string
  /** market：安装动作需要的货架条目 */
  pkg?: MarketPackageInfo
  /** local：修改动作需要的技能条目 */
  skill?: SkillInfo
}

const zoomed = ref<ZoomTarget | null>(null)
/** true = 弹层已挂载但隐藏，等待 ghost 分段动画到位后立即呈现 */
const zoomPreparing = ref(true)
const zoomClosing = ref(false)
const zoomCardRef = ref<HTMLElement | null>(null)

/** SKILL.md 正文渲染结果（frontmatter 已剥离） */
const zoomContentHtml = ref('')
const zoomContentLoading = ref(false)
const zoomContentError = ref('')
/** 请求序号：快速开关/切换目标时丢弃过期响应，防旧内容污染新弹层 */
let zoomReqSeq = 0

/** FLIP ghost 元素与来源卡片（命令式管理，随动画创建/销毁） */
let zoomGhost: HTMLDivElement | null = null
let zoomSourceEl: HTMLElement | null = null
let zoomAnim: Animation | null = null

const prefersReducedMotion =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** 加载并渲染技能正文：本地读技能目录，市场优先读已安装副本、未安装走预览 RPC（下载读取不安装） */
async function loadZoomContent(target: ZoomTarget) {
  const seq = ++zoomReqSeq
  zoomContentHtml.value = ''
  zoomContentError.value = ''
  zoomContentLoading.value = true
  try {
    const raw = await store.readSkillDoc(target.kind, target.name, target.skill?.root_dir)
    if (seq !== zoomReqSeq || !zoomed.value) return
    zoomContentHtml.value = renderMarkdown(raw)
  } catch (err: unknown) {
    if (seq !== zoomReqSeq || !zoomed.value) return
    zoomContentError.value = err instanceof Error ? err.message : '读取技能内容失败'
  } finally {
    if (seq === zoomReqSeq) zoomContentLoading.value = false
  }
}

/** 在来源卡片位置创建 ghost（纯色圆角盒，scale 拉伸不会暴露形变） */
function createGhost(rect: DOMRect): HTMLDivElement {
  const g = document.createElement('div')
  g.style.cssText = [
    'position:fixed',
    `left:${rect.left}px`,
    `top:${rect.top}px`,
    `width:${rect.width}px`,
    `height:${rect.height}px`,
    'background:var(--mx-bg-surface)',
    'border:0.5px solid var(--mx-separator-soft)',
    'border-radius:var(--mx-radius-card)',
    'box-shadow:var(--mx-shadow-prominent)',
    'z-index:2001',
    'pointer-events:none',
    'transform-origin:top left',
  ].join(';')
  document.body.appendChild(g)
  return g
}

function removeGhost() {
  zoomAnim?.cancel()
  zoomAnim = null
  zoomGhost?.remove()
  zoomGhost = null
}

function restoreSourceCard() {
  if (zoomSourceEl) zoomSourceEl.style.visibility = ''
  zoomSourceEl = null
}

function disposeZoomOverlay() {
  removeGhost()
  restoreSourceCard()
  zoomed.value = null
  zoomPreparing.value = true
  zoomClosing.value = false
}

/** 打开详情：拉宽 → 拉高 → 到位即呈现 */
function openZoomWith(target: ZoomTarget, sourceEl: HTMLElement | null) {
  zoomClosing.value = false
  zoomPreparing.value = true
  zoomed.value = target
  void loadZoomContent(target)

  // reduced motion：跳过分段动画，弹层直接呈现
  if (prefersReducedMotion) {
    zoomPreparing.value = false
    return
  }

  // 卡片让位给 ghost（同一帧无缝换位，视觉上就是卡片自己移位）
  restoreSourceCard()
  zoomSourceEl = sourceEl
  if (zoomSourceEl) zoomSourceEl.style.visibility = 'hidden'
  const cardRect = zoomSourceEl
    ? zoomSourceEl.getBoundingClientRect()
    : new DOMRect(window.innerWidth / 2 - 200, window.innerHeight / 2 - 120, 400, 240)
  removeGhost()
  zoomGhost = createGhost(cardRect)

  void nextTick(() => {
    if (!zoomGhost || !zoomed.value) return
    const dialogRect = zoomCardRef.value?.getBoundingClientRect()
    if (!dialogRect || dialogRect.width === 0) {
      // 弹层量不到尺寸（异常兜底）：跳过动画直接呈现
      removeGhost()
      restoreSourceCard()
      zoomPreparing.value = false
      return
    }
    const dx = dialogRect.left - cardRect.left
    const dy = dialogRect.top - cardRect.top
    const sx = dialogRect.width / cardRect.width
    const sy = dialogRect.height / cardRect.height
    zoomAnim = zoomGhost.animate(
      [
        { transform: 'translate(0px, 0px) scale(1, 1)', offset: 0, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
        // ① 拉长左右至弹层宽度
        { transform: `translate(${dx}px, 0px) scale(${sx}, 1)`, offset: 0.55, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
        // ② 拉长上下至弹层高度，到位即终结（弹层立即接管，无淡入尾段）
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, offset: 1 },
      ],
      { duration: 620, fill: 'forwards' },
    )
    zoomAnim.onfinish = () => {
      // 换位顺序不能反：先让弹层立即不透明（与 ghost 同矩形同底色，视觉无缝），
      // 渲染一帧后再撤 ghost 与恢复卡片——若先撤 ghost，落位矩形会出现一帧大空隙
      if (zoomed.value) zoomPreparing.value = false
      void nextTick(() => {
        removeGhost()
        restoreSourceCard()
      })
    }
  })
}

function openZoomLocal(skill: SkillInfo, e?: Event) {
  openZoomWith(
    {
      kind: 'local',
      title: skillDisplayName(skill),
      name: skill.name,
      tagText: isThirdParty(skill) ? '第三方' : '全局技能',
      tagTone: isThirdParty(skill) ? 'warning' : 'info',
      description: skillLocaleDesc(skill) || '(无描述)',
      skill,
    },
    (e?.currentTarget as HTMLElement) || null,
  )
}

function openZoomMarket(pkg: MarketPackageInfo, e?: Event) {
  const installed = store.installedNames.has(pkg.name)
  openZoomWith(
    {
      kind: 'market',
      title: store.marketDisplayName(pkg),
      name: pkg.name,
      tagText: installed ? '已安装' : '未安装',
      tagTone: installed ? 'success' : 'info',
      description: pkg.description || '(无描述)',
      pkg,
    },
    (e?.currentTarget as HTMLElement) || null,
  )
}

/** 关闭详情：弹层淡出，ghost 反向收上下 → 收左右 → 落回格子 */
function closeZoom() {
  if (!zoomed.value || zoomClosing.value || zoomPreparing.value) return
  zoomClosing.value = true
  zoomReqSeq++ // 作废在途内容请求

  if (prefersReducedMotion) {
    window.setTimeout(disposeZoomOverlay, 160)
    return
  }

  const dialogRect = zoomCardRef.value?.getBoundingClientRect()
  const cardRect = zoomSourceEl?.getBoundingClientRect()
  if (!dialogRect || dialogRect.width === 0 || !cardRect || cardRect.width === 0) {
    window.setTimeout(disposeZoomOverlay, 200)
    return
  }
  const dx = dialogRect.left - cardRect.left
  const dy = dialogRect.top - cardRect.top
  const sx = dialogRect.width / cardRect.width
  const sy = dialogRect.height / cardRect.height
  removeGhost()
  zoomGhost = createGhost(dialogRect)
  zoomAnim = zoomGhost.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, offset: 0, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      // 反向 ① 收上下
      { transform: `translate(${dx}px, 0px) scale(${sx}, 1)`, offset: 0.55, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      // 反向 ② 收左右，落回格子
      { transform: 'translate(0px, 0px) scale(1, 1)', offset: 1 },
    ],
    { duration: 460, fill: 'forwards' },
  )
  zoomAnim.onfinish = () => {
    disposeZoomOverlay()
  }
}

/** Esc 收详情（capture 阶段拦截，避免壳同时把设置面板一并收起） */
function onZoomKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopImmediatePropagation()
    closeZoom()
  }
}

watch(zoomed, (v) => {
  if (v) window.addEventListener('keydown', onZoomKey, true)
  else window.removeEventListener('keydown', onZoomKey, true)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onZoomKey, true)
  disposeZoomOverlay()
})

/** 弹层内修改（本地技能）：先硬关弹层再进编辑 modal（壳 modal z 序低于 Teleport 层） */
function editFromZoom(target: ZoomTarget) {
  const skill = target.skill
  disposeZoomOverlay()
  if (skill) onEdit(skill)
}

/** 弹层内安装：先硬关弹层再走安装流程（确认 modal 同受 z 序约束） */
function installFromZoom(target: ZoomTarget) {
  const pkg = target.pkg
  disposeZoomOverlay()
  if (pkg) onInstall(pkg)
}

// ── 视图分段页签指示器（.mx-tabs 指示器位移经 JS 写 transform） ──
const tabsRef = ref<HTMLElement | null>(null)

function syncIndicator(): void {
  const root = tabsRef.value
  if (!root) return
  const tab = root.querySelector<HTMLButtonElement>('button[aria-selected="true"]')
  const ind = root.querySelector<HTMLElement>(`:scope > .${$style.tabsIndicator}`)
  if (!tab || !ind) return
  ind.style.width = `${tab.offsetWidth}px`
  ind.style.transform = `translateX(${tab.offsetLeft - 4}px)`
}

watch(view, () => void nextTick(syncIndicator))
onMounted(syncIndicator)
</script>

<template>
  <div :class="$style.wrap">
    <!-- 节头：标题 + 说明 + 导入动作（本地视图） -->
    <div :class="$style.sectionHead">
      <div :class="$style.headText">
        <span :class="$style.sectionTitle">技能</span>
        <span :class="$style.sectionHint">管理全局技能与在线市场；安装后即可在会话中启用</span>
      </div>
      <button v-if="view === 'local'" type="button" class="mx-btn" :class="$style.importBtn" @click="onImport">
        <MxIcon name="lucide:package-plus" :size="16" />
        <span>导入分发包</span>
      </button>
    </div>

    <!-- 工具栏：页签独占一行居中，搜索独占一行全宽（计数与手动刷新冗余，已删） -->
    <div :class="$style.tabsRow">
      <div ref="tabsRef" class="mx-tabs" :class="$style.viewTabs">
        <span :class="$style.tabsIndicator" aria-hidden="true" />
        <button type="button" class="mx-tab" role="tab" :aria-selected="view === 'local' ? 'true' : 'false'" @click="view = 'local'">
          本地
        </button>
        <button type="button" class="mx-tab" role="tab" :aria-selected="view === 'market' ? 'true' : 'false'" @click="view = 'market'">
          在线市场
        </button>
      </div>
    </div>
    <input v-if="view === 'local'" v-model="searchQuery" class="mx-input" :class="$style.search" placeholder="搜索技能名称或描述" />
    <input v-else v-model="marketSearch" class="mx-input" :class="$style.search" placeholder="搜索技能名称或描述" />

    <!-- 市场降级提示（在线拉取失败降级本地缓存） -->
    <p v-if="view === 'market' && store.marketWarning" :class="$style.warning">{{ store.marketWarning }}</p>

    <!-- 分类标签行（仅市场视图；固定分类在前、其余字典序在后） -->
    <div v-if="view === 'market' && store.marketDomains.length > 0" :class="$style.domains">
      <button
        type="button"
        :class="$style.domainTag"
        :aria-pressed="marketDomain === '' ? 'true' : 'false'"
        @click="marketDomain = ''"
      >
        全部
      </button>
      <button
        v-for="d in store.marketDomains"
        :key="d"
        type="button"
        :class="$style.domainTag"
        :aria-pressed="marketDomain === d ? 'true' : 'false'"
        @click="marketDomain = marketDomain === d ? '' : d"
      >
        {{ d }}
      </button>
    </div>

    <!-- ── 本地视图 ── -->
    <template v-if="view === 'local'">
      <p v-if="store.loading && !store.loaded" :class="[$style.hint, 'mx-text-loading']">正在加载技能清单…</p>
      <div v-else-if="filteredSkills.length > 0" :class="$style.grid">
        <div
          v-for="skill in filteredSkills"
          :key="skill.name"
          role="button"
          tabindex="0"
          :class="$style.card"
          @click="openZoomLocal(skill, $event)"
          @keydown.enter.prevent="openZoomLocal(skill, $event)"
        >
          <div :class="$style.cardTop">
            <span :class="$style.avatar">{{ (skillDisplayName(skill) || '?').charAt(0).toUpperCase() }}</span>
            <div :class="$style.titleCol">
              <span :class="$style.name" :title="skill.name">{{ skillDisplayName(skill) }}</span>
              <span :class="$style.id">{{ skill.name }}</span>
            </div>
            <span v-if="isThirdParty(skill)" class="mx-tag" data-tone="warning">第三方</span>
          </div>
          <p :class="$style.desc" :title="skillLocaleDesc(skill)">{{ skillLocaleDesc(skill) || '(无描述)' }}</p>
          <div :class="$style.tagRow">
            <span v-if="skill.metadata?.version" class="mx-tag" data-tone="info">v{{ skill.metadata?.version }}</span>
            <span v-if="skill.metadata?.author" class="mx-tag" data-tone="neutral">{{ skill.metadata?.author }}</span>
            <span
              v-if="skill.license"
              class="mx-tag"
              data-tone="warning"
              :class="$style.licenseTag"
              role="button"
              tabindex="0"
              @click.stop="onLicense(skill)"
              @keydown.enter.prevent="onLicense(skill)"
            >许可证</span>
          </div>
          <div :class="$style.cardFoot" @click.stop>
            <span></span>
            <div :class="$style.cardActions">
              <button type="button" class="mx-icon-btn" aria-label="导出为分发包" @click="onExport(skill)">
                <MxIcon name="lucide:download" :size="16" />
              </button>
              <button type="button" class="mx-icon-btn" aria-label="修改 SKILL.md" @click="onEdit(skill)">
                <MxIcon name="lucide:pencil" :size="16" />
              </button>
              <button type="button" class="mx-icon-btn" aria-label="删除技能" @click="onDelete(skill)">
                <MxIcon name="lucide:trash-2" :size="16" />
              </button>
            </div>
          </div>
        </div>
      </div>
      <p v-else :class="$style.hint">暂无技能；可从在线市场安装，或导入分发包。</p>
    </template>

    <!-- ── 在线市场视图（skill 类型分发包，安装进全局库） ── -->
    <template v-else>
      <p v-if="store.marketLoading && !store.marketLoaded" :class="[$style.hint, 'mx-text-loading']">正在加载市场清单…</p>
      <div v-else-if="filteredMarketPackages.length > 0" :class="$style.grid">
        <div
          v-for="pkg in filteredMarketPackages"
          :key="pkg.kind + '/' + pkg.name"
          role="button"
          tabindex="0"
          :class="$style.card"
          @click="openZoomMarket(pkg, $event)"
          @keydown.enter.prevent="openZoomMarket(pkg, $event)"
        >
          <div :class="$style.cardTop">
            <span :class="$style.avatar">{{ (store.marketDisplayName(pkg) || '?').charAt(0).toUpperCase() }}</span>
            <div :class="$style.titleCol">
              <span :class="$style.name" :title="pkg.name">{{ store.marketDisplayName(pkg) }}</span>
              <span :class="$style.id">{{ pkg.name }}</span>
            </div>
            <!-- 安装动作上移至右上角取代状态标签；已安装仅显示标签，覆盖安装走详情弹层 -->
            <button
              v-if="!store.installedNames.has(pkg.name)"
              type="button"
              class="mx-btn mx-btn--primary"
              :disabled="store.installing === pkg.name"
              @click.stop="onInstall(pkg)"
            >
              <span v-if="store.installing === pkg.name" class="mx-text-loading">安装中…</span>
              <template v-else>安装</template>
            </button>
            <span v-else class="mx-tag" data-tone="success">已安装</span>
          </div>
          <p :class="$style.desc" :title="pkg.description">{{ pkg.description || '(无描述)' }}</p>
        </div>
      </div>
      <p v-else-if="store.marketLoaded" :class="$style.hint">市场暂无可安装的技能。</p>
      <p v-else :class="$style.hint">市场清单加载失败，请点击刷新重试。</p>
    </template>

    <!-- ── 技能详情弹层：FLIP 分段动效（ghost 卡片拉宽→拉高），到位即呈现 ── -->
    <Teleport to="body">
      <div
        v-if="zoomed"
        :class="[$style.zoomBackdrop, { [$style.zoomPreparing]: zoomPreparing, [$style.zoomClosing]: zoomClosing }]"
        @click="closeZoom"
      >
        <div
          ref="zoomCardRef"
          :class="[$style.zoomCard, { [$style.zoomPreparing]: zoomPreparing, [$style.zoomClosing]: zoomClosing }]"
          @click.stop
        >
          <div :class="$style.cardTop">
            <span :class="$style.avatar">{{ (zoomed.title || '?').charAt(0).toUpperCase() }}</span>
            <div :class="$style.titleCol">
              <span :class="$style.name">{{ zoomed.title }}</span>
              <span :class="$style.id">{{ zoomed.name }}</span>
            </div>
            <span class="mx-tag" :data-tone="zoomed.tagTone">{{ zoomed.tagText }}</span>
          </div>
          <p :class="$style.zoomDesc">{{ zoomed.description }}</p>

          <!-- SKILL.md 正文：markdown 渲染；加载 / 失败 / 正文三态 -->
          <div :class="$style.zoomContent">
            <p v-if="zoomContentLoading" :class="[$style.hint, 'mx-text-loading']">正在加载内容…</p>
            <p v-else-if="zoomContentError" :class="$style.warning">内容预览失败：{{ zoomContentError }}</p>
            <!-- 渲染结果经 DOMPurify 消毒（markdown.ts 统一防线） -->
            <div v-else-if="zoomContentHtml" :class="$style.markdown" v-html="zoomContentHtml"></div>
            <p v-else :class="$style.hint">该技能没有可展示的内容</p>
          </div>

          <div :class="$style.cardFoot" @click.stop>
            <span></span>
            <div :class="$style.cardActions">
              <button v-if="zoomed.kind === 'local'" type="button" class="mx-btn" @click="editFromZoom(zoomed)">修改</button>
              <button
                v-else-if="zoomed.pkg"
                type="button"
                class="mx-btn"
                :class="{ 'mx-btn--primary': !store.installedNames.has(zoomed.name) }"
                :disabled="store.installing === zoomed.name"
                @click="installFromZoom(zoomed)"
              >
                <span v-if="store.installing === zoomed.name" class="mx-text-loading">安装中…</span>
                <template v-else>{{ store.installedNames.has(zoomed.name) ? '覆盖安装' : '安装' }}</template>
              </button>
              <button type="button" class="mx-btn" :class="$style.zoomClose" @click="closeZoom">关闭</button>
            </div>
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

/* 页签行：页签组独占一行且水平居中 */
.tabsRow {
  display: flex;
  justify-content: center;
}

/* 视图页签：两档等宽（grid 1fr 平分），indicator 与 .mx-tabs-indicator 同几何 */
.viewTabs {
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
}

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

/* 节头右侧导入按钮：图标与文字对齐（原工具栏按钮样式迁移至此） */
.importBtn {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-1);
}

.search {
  width: 100%;
}

.warning {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-state-warn-label);
}

/* 分类标签行：胶囊小钮，选中态 accent 描边 */
.domains {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  flex-wrap: wrap;
}

.domainTag {
  height: 24px;
  padding: 0 12px;
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: 999px;
  background: var(--mx-module);
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  cursor: pointer;
  transition:
    border-color var(--mx-duration-fast) var(--mx-ease-standard),
    color var(--mx-duration-fast) var(--mx-ease-standard);
}

.domainTag:hover {
  border-color: var(--mx-border-strong);
}

.domainTag:active {
  background: var(--mx-active);
}

.domainTag:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 1px;
}

.domainTag[aria-pressed='true'] {
  border-color: var(--mx-accent);
  color: var(--mx-accent);
}

/* 卡片网格：自适应列宽（与连接器/源组件同布局口径） */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--mx-space-3);
  align-content: start;
  /* 卡片高度随内容自适应（不随行内最高卡片拉伸） */
  align-items: start;
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  padding: var(--mx-space-3);
  background: var(--mx-bg-surface);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-card);
  cursor: pointer;
  transition:
    border-color var(--mx-duration-fast) var(--mx-ease-standard),
    transform 300ms cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 300ms cubic-bezier(0.16, 1, 0.3, 1);
}

.card:hover {
  border-color: var(--mx-border-selected);
  transform: translateY(-2px);
  box-shadow: var(--mx-shadow-panel);
}

.card:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: 1px;
}

.cardTop {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
}

.avatar {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: var(--mx-radius-control);
  background: var(--mx-module);
  font: var(--mx-font-heading);
  color: var(--mx-text-secondary);
}

.titleCol {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.name {
  font: var(--mx-font-body);
  font-weight: 600;
  color: var(--mx-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.id {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.desc {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.tagRow {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  flex-wrap: wrap;
}

/* 许可证 tag 可点击打开阅读器 */
.licenseTag {
  cursor: pointer;
}

.cardFoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-1);
  margin-top: auto;
}

.cardActions {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
}

/* 悬停操作组：opacity 淡入（visibility 会打断键盘可达） */
.card .cardActions {
  opacity: 0;
  transition: opacity var(--mx-duration-fast) var(--mx-ease-standard);
}

.card:hover .cardActions,
.card:focus-within .cardActions {
  opacity: 1;
}

/* 测连/安装进行中：图标旋转示意 */
.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.hint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  padding: var(--mx-space-2) 0;
}

/* ── 详情弹层：FLIP 分段动效由 ghost 元素承担（WAAPI transform），弹层仅退场做透明度过渡；
      不用 backdrop-filter——大面积实时模糊是此前弹层卡顿的根源，纯色压暗即可 ── */
/* 遮罩入场即时呈现（无透明度过渡——ghost 落位即全量显示，无"模糊到显示"尾段）；
   仅退场走淡出 */
.zoomBackdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mx-mask);
  opacity: 1;
}

.zoomBackdrop.zoomPreparing {
  opacity: 0;
  transition: none;
}

.zoomBackdrop.zoomClosing {
  opacity: 0;
  transition: opacity 160ms ease;
}

.zoomCard {
  /* 固定尺寸：ghost 落点矩形确定，正文加载完成也不跳动 */
  width: min(880px, 92vw);
  height: min(84vh, 780px);
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
  padding: var(--mx-space-4);
  box-sizing: border-box;
  border-radius: var(--mx-radius-window);
  background: var(--mx-bg-elevated);
  border: 0.5px solid var(--mx-separator-soft);
  box-shadow: var(--mx-shadow-prominent);
  /* 入场不做透明度过渡：ghost 落位瞬间弹层立即不透明换位，避免落位矩形出现空隙；
     仅退场走淡出（退场时 ghost 已盖住矩形，淡出不可见，双保险） */
  opacity: 1;
  transition: none;
}

.zoomCard.zoomPreparing {
  opacity: 0;
}

.zoomCard.zoomClosing {
  opacity: 0;
  transition: opacity 160ms ease;
}

.zoomDesc {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  line-height: 1.7;
  word-break: break-word;
  white-space: pre-wrap;
}

/* 正文区：分隔线之上为头部（标题+描述）；头部与底栏钉住，仅正文滚动 */
.zoomContent {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border-top: 0.5px solid var(--mx-separator);
  padding-top: var(--mx-space-2);
  padding-right: var(--mx-space-1);
}

.zoomClose {
  margin-left: var(--mx-space-2);
}

/* ── SKILL.md 正文 markdown 排版（v-html 内容无 module 标记，需 :global 穿透） ── */
.markdown {
  font: var(--mx-font-caption);
  line-height: 1.75;
  color: var(--mx-text);
  word-break: break-word;
}

.markdown :global(h1),
.markdown :global(h2),
.markdown :global(h3),
.markdown :global(h4) {
  margin: var(--mx-space-4) 0 var(--mx-space-2);
  font-weight: 600;
  line-height: 1.4;
  color: var(--mx-text);
}

.markdown :global(h1) {
  font: var(--mx-font-heading);
}

.markdown :global(h2) {
  font: var(--mx-font-body);
  font-weight: 600;
  font-size: 15px;
}

.markdown :global(h3),
.markdown :global(h4) {
  font: var(--mx-font-body);
  font-weight: 600;
}

.markdown :global(h1:first-child),
.markdown :global(h2:first-child) {
  margin-top: 0;
}

.markdown :global(p) {
  margin: 0 0 var(--mx-space-2);
}

.markdown :global(ul),
.markdown :global(ol) {
  margin: 0 0 var(--mx-space-2);
  padding-left: 1.5em;
}

.markdown :global(li) {
  margin: 2px 0;
}

.markdown :global(code) {
  font-family: var(--mx-font-family);
  font-size: var(--mx-font-caption);
  background: var(--mx-module);
  padding: 1px 5px;
  border-radius: 4px;
}

.markdown :global(pre) {
  margin: 0 0 var(--mx-space-2);
  padding: var(--mx-space-2) var(--mx-space-3);
  background: var(--mx-module);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-control);
  overflow-x: auto;
}

.markdown :global(pre code) {
  background: transparent;
  padding: 0;
  line-height: 1.6;
}

.markdown :global(blockquote) {
  margin: 0 0 var(--mx-space-2);
  padding: var(--mx-space-1) var(--mx-space-3);
  border-left: 3px solid var(--mx-accent);
  color: var(--mx-text-secondary);
  background: var(--mx-module);
  border-radius: 0 var(--mx-radius-control) var(--mx-radius-control) 0;
}

.markdown :global(a) {
  color: var(--mx-accent);
  text-decoration: none;
}

.markdown :global(a:hover) {
  text-decoration: underline;
}

.markdown :global(hr) {
  border: none;
  border-top: 0.5px solid var(--mx-separator);
  margin: var(--mx-space-3) 0;
}

.markdown :global(table) {
  border-collapse: collapse;
  margin: 0 0 var(--mx-space-2);
  font-size: var(--mx-font-caption);
}

.markdown :global(th),
.markdown :global(td) {
  border: 0.5px solid var(--mx-separator);
  padding: 4px 10px;
  text-align: left;
}

.markdown :global(th) {
  background: var(--mx-module);
}

.markdown :global(img) {
  max-width: 100%;
}
</style>
