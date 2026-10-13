<script setup lang="ts">
/**
 * 技能管理行："技能"设置页唯一自定义行，承载完整管理器（models 管理行先例）。
 * 本地视图：全局技能库（导出/修改/删除/许可证）。
 * 详情弹层为 FLIP 分段动效（ghost 卡片拉宽→拉高→到位即呈现），贴触发点的局部浮层
 * 由组件自绘（契约 §6：只收全局层，popover/sheet 归组件）；编辑/许可证/确认走壳 Overlay modal。
 * 注意壳 modal z 序低于本组件 Teleport 层——弹层内动作先硬关弹层再开 modal（避免层叠纠缠）。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { Component } from 'vue'
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'
import { useSkillsStore, skillDisplayName, skillLocaleDesc, isThirdParty, SkillExistsError } from '../store'
import MetricRateButtons from './MetricRateButtons.vue'
import { pushNotice } from '../notice'
import { MODAL_SKILLS_CONFIRM, MODAL_SKILL_LICENSE } from '../ids'
import { renderMarkdown } from '../markdown'
import type { SkillInfo } from '../types'
import ConfirmModal from '../overlays/ConfirmModal.vue'
import { openMarkdownSheet } from '../../markdown/sheetEditor'
import LicenseModal from '../overlays/LicenseModal.vue'

const store = useSkillsStore()
const shell = useShell()

onMounted(() => {
  store.loadSkills().catch((err: unknown) => {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '加载技能清单失败')
  })
  // 市场评分映射（增强信息：市场不可达时留空，不阻断技能管理）
  store.loadMarketRatings().catch(() => {})
})

/** 卡片评分展示（市场货架数据；无评分数据返回 null 不渲染） */
function marketRating(name: string): { avg: number; count: number } | null {
  const r = store.marketRatings[name]
  if (!r || !r.count) return null
  return { avg: r.avg ?? 0, count: r.count }
}

/** modal 互斥惯例：add 前先 remove 同 id（契约 §6） */
function openModal(id: string, component: Component) {
  if (shell.Overlay.has(id)) shell.Overlay.remove(id)
  shell.Overlay.add({ id, kind: 'modal', component })
}

function openConfirm(): void {
  openModal(MODAL_SKILLS_CONFIRM, ConfirmModal)
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

/** 修改 SKILL.md：markdown 插件的 Sheet 编辑器（工具栏 + CodeMirror），保存失败 Sheet 保持打开 */
async function onEdit(skill: SkillInfo) {
  try {
    const content = await store.loadSkillMd(skill)
    openMarkdownSheet(shell, {
      id: 'skills-edit',
      title: `修改 ${skillDisplayName(skill)}`,
      value: content,
      placeholder: '输入 Markdown 内容',
      onSave: (v) => store.saveSkillMd(skill, v),
    })
  } catch (err: unknown) {
    pushNotice(shell, 'error', err instanceof Error ? err.message : '读取 SKILL.md 失败')
  }
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

// ── 详情弹层（本地卡片）：FLIP 分段动效 + SKILL.md markdown 正文预览 ──
// 动效编排（只动 transform/opacity，GPU 合成零重排，不用 backdrop-filter）：
// 点击卡片 → ① 拉长左右至弹层宽度 → ② 拉长上下至弹层高度，到位即终结（弹层立即呈现，无淡入尾段）；
// 关闭时反向：先收上下 → 再收左右 → 落回格子。

interface ZoomTarget {
  /** 展示名 */
  title: string
  /** 技能原名 */
  name: string
  tagText: string
  tagTone: 'success' | 'info' | 'warning'
  description: string
  /** 修改动作需要的技能条目 */
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

/** 加载并渲染技能正文：本地读技能目录 */
async function loadZoomContent(target: ZoomTarget) {
  const seq = ++zoomReqSeq
  zoomContentHtml.value = ''
  zoomContentError.value = ''
  zoomContentLoading.value = true
  try {
    const raw = await store.readSkillDoc(target.skill?.root_dir)
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

/** 弹层内修改（本地技能）：先收详情弹层，再拉起 markdown Sheet 编辑器（同为壳层，无 z 序冲突） */
function editFromZoom(target: ZoomTarget) {
  const skill = target.skill
  disposeZoomOverlay()
  if (skill) onEdit(skill)
}
</script>

<template>
  <div :class="$style.wrap">
    <!-- 节头：标题 + 说明 + 导入动作 -->
    <div :class="$style.sectionHead">
      <div :class="$style.headText">
        <span :class="$style.sectionTitle">技能</span>
        <span :class="$style.sectionHint">管理全局技能；安装后即可在会话中启用</span>
      </div>
      <button type="button" class="mx-btn" :class="$style.importBtn" @click="onImport">
        <MxIcon name="lucide:package-plus" :size="16" />
        <span>导入分发包</span>
      </button>
    </div>
    <input v-model="searchQuery" class="mx-input" :class="$style.search" placeholder="搜索技能名称或描述" />

    <!-- ── 全局技能库 ── -->
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
          <span :class="$style.avatar"><MxIcon name="lucide:sparkles" :size="20" /></span>
          <div :class="$style.titleCol">
            <span :class="$style.name" :title="skill.name">{{ skillDisplayName(skill) }}</span>
            <p :class="$style.desc" :title="skillLocaleDesc(skill)">{{ skillLocaleDesc(skill) || '(无描述)' }}</p>
          </div>
          <span v-if="isThirdParty(skill)" class="mx-tag" data-tone="warning">第三方</span>
          <!-- 操作组右上角（@click.stop 防触发卡片详情弹层） -->
          <div :class="$style.cardActions" @click.stop>
            <!-- 决策计量：技能整体评价双指（agent.rate subject_type=skill，每日限频） -->
            <MetricRateButtons :name="skill.name" />
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
        <div :class="$style.tagRow">
          <span v-if="skill.metadata?.version" class="mx-tag" data-tone="info">v{{ skill.metadata?.version }}</span>
          <!-- 市场评分（货架聚合；仅在市场有评分数据时显示） -->
          <span v-if="marketRating(skill.name)" class="mx-tag" data-tone="warning">★ {{ marketRating(skill.name)!.avg.toFixed(1) }}（{{ marketRating(skill.name)!.count }}）</span>
          <span v-if="skill.metadata?.author" class="mx-tag" data-tone="neutral">{{ skill.metadata?.author }}</span>
          <span
            v-if="skill.license"
            class="mx-tag"
            data-tone="warning"
            :class="$style.licenseTag"
            role="button"
            tabindex="0"
            :title="`查看许可证 ${skill.license}`"
            @click.stop="onLicense(skill)"
            @keydown.enter.prevent="onLicense(skill)"
          >{{ skill.license }}</span>
        </div>
      </div>
    </div>
    <p v-else :class="$style.hint">暂无技能；可导入分发包。</p>

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
            <span :class="$style.avatar"><MxIcon name="lucide:sparkles" :size="20" /></span>
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
              <button type="button" class="mx-btn" @click="editFromZoom(zoomed)">修改</button>
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
