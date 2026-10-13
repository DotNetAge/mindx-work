<script setup lang="ts">
/**
 * 插件设置行：页面头（标题「插件」+ 描述）+ 已安装插件管理与官方可选件释放安装，
 * Tab 分段切换（与市场页同款 mx-tabs 分段控件）——「已安装」/「可选」同级页签。
 * 已安装列表为两列折叠卡片：头部 = 名称 + 一句话描述 + 状态点 + 启停标签 + chevron；
 * 展开区 = 作者 / 版本（切版）/ 发布日期 / 授权 / Github 与全部操作（启停 + 卸载）。
 * 可选页 = 发行搭载、未安装待释放的 .mindpkg 卡片（安装即启用；卸载后回此页可重装）。
 * 样式严格用 mx-uikit：原语类（mx-tabs/mx-tab/mx-btn/mx-switch/mx-pill/mx-menu/mx-icon-btn/mx-dot/mx-tag）
 * + token；布局/折叠/指示器为模块类。
 */
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { InstalledPluginView } from '@mindx-work/ui-shell'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useMarketStore } from '../store'
import RatingEntry from '../RatingEntry.vue'

const store = useMarketStore()

/** 当前 Tab（已安装 / 可选） */
type TabKey = 'installed' | 'optional'
const activeTab = ref<TabKey>('installed')
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'installed', label: '已安装' },
  { key: 'optional', label: '可选' },
]

/** 当前展开卡片的插件 id 集合（多开互不影响） */
const expanded = ref<Set<string>>(new Set())
/** 当前展开版本菜单的插件 id（null = 全部收起） */
const verMenuFor = ref<string | null>(null)

// ── 分段页签指示器（.mx-tabs 指示器位移经 JS 写 transform，与市场页同款） ──
const tabsRef = ref<HTMLElement | null>(null)

function syncIndicator(): void {
  const root = tabsRef.value
  if (!root) return
  const tab = root.querySelector<HTMLButtonElement>('button[aria-selected="true"]')
  const ind = root.querySelector<HTMLElement>(':scope > [data-indicator]')
  if (!tab || !ind) return
  ind.style.width = `${tab.offsetWidth}px`
  ind.style.transform = `translateX(${tab.offsetLeft - 4}px)`
}

watch(activeTab, () => void nextTick(syncIndicator))

onMounted(() => {
  void store.refreshInstalled()
  void store.loadOptionalPlugins()
  window.addEventListener('click', closeVerMenu)
  // 分段指示器首帧定位（布局稳定后测量）
  void nextTick(syncIndicator)
})
onUnmounted(() => window.removeEventListener('click', closeVerMenu))

function closeVerMenu() {
  verMenuFor.value = null
}

function toggleCard(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function onSwitchVersion(view: InstalledPluginView, version: string) {
  verMenuFor.value = null
  if (version !== view.version) void store.switchVersion(view, version)
}

/** 发布日期人性化（epoch ms → 本地日期；缺失显示 —） */
function fmtDate(ts?: number): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '—'
  return new Date(ts).toLocaleDateString()
}
</script>

<template>
  <div :class="$style.wrap">
    <!-- ── 页面头（与市场页同构：标题 + 描述） ── -->
    <div :class="$style.head">
      <span :class="$style.title">插件</span>
      <span :class="$style.pageDesc">配置与查看已安装的插件</span>
    </div>

    <!-- ── 已安装 / 可选 分段切换（与市场页同款 mx-tabs 分段控件） ── -->
    <div ref="tabsRef" class="mx-tabs" :class="$style.viewTabs">
      <span data-indicator aria-hidden="true" :class="$style.tabsIndicator" />
      <button
        v-for="t in TABS"
        :key="t.key"
        type="button"
        class="mx-tab"
        role="tab"
        :aria-selected="activeTab === t.key ? 'true' : 'false'"
        @click="activeTab = t.key"
      >{{ t.label }}</button>
    </div>

    <!-- ══════════ 已安装 ══════════ -->
    <section v-show="activeTab === 'installed'">
      <div :class="$style.grid">
        <div v-for="view in store.installed" :key="view.id" :class="$style.card">
          <!-- 卡片头：名称 + 描述 + 状态点 + 启停标签 + chevron（整头可点折叠） -->
          <button
            type="button"
            :class="$style.cardHead"
            :aria-expanded="expanded.has(view.id) ? 'true' : 'false'"
            @click="toggleCard(view.id)"
          >
            <div :class="$style.headText">
              <span :class="$style.cardName">{{ view.name }}</span>
              <span :class="$style.cardDesc">{{ view.description || view.id }}</span>
            </div>
            <div :class="$style.headMeta">
              <span class="mx-dot" :data-state="view.enabled ? 'success' : 'idle'" />
              <span class="mx-tag" :data-tone="view.enabled ? 'success' : 'neutral'">
                {{ view.enabled ? '已启用' : '已停用' }}
              </span>
              <MxIcon name="lucide:chevron-down" :size="16" :class="[$style.chev, expanded.has(view.id) ? $style.chevOpen : '']" />
            </div>
          </button>

          <!-- 展开区：元信息 + 操作 -->
          <div v-show="expanded.has(view.id)" :class="$style.cardBody">
            <div :class="$style.infoGrid">
              <span :class="$style.infoLabel">作者</span>
              <span :class="$style.infoValue">{{ view.author || '—' }}</span>
              <span :class="$style.infoLabel">版本</span>
              <span :class="$style.infoValue">
                <span>{{ view.version }}</span>
                <span v-if="view.versions.length > 1" :class="$style.verHost">
                  <button
                    type="button"
                    class="mx-pill"
                    @click.stop="verMenuFor = verMenuFor === view.id ? null : view.id"
                  >
                    <span>切换</span>
                    <MxIcon name="lucide:chevron-down" :size="16" />
                  </button>
                  <div v-if="verMenuFor === view.id" class="mx-menu" @click.stop>
                    <button
                      v-for="v in view.versions"
                      :key="v"
                      type="button"
                      class="mx-menu-item"
                      :data-active="v === view.version ? 'true' : 'false'"
                      @click="onSwitchVersion(view, v)"
                    >
                      <span>{{ v }}</span>
                      <MxIcon v-if="v === view.version" name="lucide:check" :size="16" />
                    </button>
                  </div>
                </span>
              </span>
              <span :class="$style.infoLabel">发布日期</span>
              <span :class="$style.infoValue">{{ fmtDate(view.publishedAt) }}</span>
              <span :class="$style.infoLabel">授权</span>
              <span :class="$style.infoValue">{{ view.license || '—' }}</span>
              <span :class="$style.infoLabel">Github</span>
              <span :class="$style.infoValue">
                <a v-if="view.repo" :href="view.repo" target="_blank" rel="noreferrer" :class="$style.repoLink">{{ view.repo }}</a>
                <template v-else>—</template>
              </span>
            </div>
            <div :class="$style.actions">
              <!-- 评分入口（§2.3 已装卡片操作行星标；kind=plugin 挂插件 id） -->
              <RatingEntry :pkg="{ kind: 'plugin', name: view.id, sha256: '' }" />
              <button
                type="button"
                class="mx-switch"
                role="switch"
                :aria-checked="view.enabled ? 'true' : 'false'"
                :aria-label="view.enabled ? '停用插件' : '启用插件'"
                :disabled="store.busyId === view.id"
                @click="view.enabled ? store.disable(view) : store.enable(view)"
              >
                <span class="mx-switch-thumb" />
              </button>
              <button
                type="button"
                class="mx-icon-btn"
                aria-label="卸载"
                :disabled="store.busyId === view.id"
                @click="store.uninstall(view)"
              >
                <MxIcon name="lucide:trash-2" :size="16" />
              </button>
            </div>
          </div>
        </div>
      </div>
      <p v-if="store.installed.length === 0" :class="$style.hint">
        尚未安装在线插件；可在「资源社区」页的插件货架安装，或从「可选」页安装官方可选件。
      </p>
    </section>

    <!-- ══════════ 可选（官方可选件：发行搭载、未安装待释放；安装即启用，卸载后可回此页重装） ══════════ -->
    <section v-show="activeTab === 'optional'">
      <div v-if="store.optionalPlugins.length > 0" :class="$style.grid">
        <div v-for="opt in store.optionalPlugins" :key="opt.id" :class="$style.card">
          <div :class="$style.optBody">
            <div :class="$style.headText">
              <span :class="$style.cardName">{{ opt.name }}</span>
              <span class="mx-tag" data-tone="neutral">v{{ opt.version }}</span>
            </div>
            <p :class="$style.optDesc">{{ opt.description }}</p>
            <span v-if="opt.author" :class="$style.optAuthor">{{ opt.author }}</span>
          </div>
          <div :class="$style.optActions">
            <button
              type="button"
              class="mx-btn mx-btn--primary"
              :disabled="store.busyId !== null"
              @click="store.installOptional(opt.file)"
            >
              <span v-if="store.busyId === `__optional__${opt.file}`" class="mx-text-loading">安装中…</span>
              <template v-else>安装</template>
            </button>
          </div>
        </div>
      </div>
      <p v-else :class="$style.hint">发行版未搭载可选件，或已全部安装。</p>
    </section>

    <p v-if="store.lastError" :class="$style.error">{{ store.lastError }}</p>
  </div>
</template>

<style module>
/* 行容器：单行占满设置页内容区，页面头 + Tab + 内容区纵向排布 */
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-4);
  padding: var(--mx-space-4) 0;
}

/* 页面头：标题 + 描述同基线（与市场页 head 同构） */
.head {
  display: flex;
  align-items: baseline;
  gap: var(--mx-space-3);
}

.title {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.pageDesc {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

/* 分段页签指示器：与市场页同款（JS 写 width/transform，位移补偿容器 padding 4） */
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

/* 分段容器：两档等宽（grid 1fr 平分），随内容区顶部对齐 */
.viewTabs {
  flex: none;
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
  border-bottom: none;
  padding-bottom: 0;
}

.viewTabs :global(.mx-tab) {
  white-space: nowrap;
}

/* ── 两列卡片网格（窄内容区也保持两列，贴定稿截图） ── */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--mx-space-2);
}

/* ── 可选件卡片：信息区 + 安装操作 ── */
.optBody {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  padding: var(--mx-space-3);
}

.optDesc {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.optAuthor {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.optActions {
  display: flex;
  justify-content: flex-end;
  padding: 0 var(--mx-space-3) var(--mx-space-3);
}

.card {
  overflow: hidden;
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-card);
  background: var(--mx-bg-surface);
}

/* 卡片头按钮 reset：整头可点折叠 */
.cardHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
  width: 100%;
  padding: var(--mx-space-3);
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.cardHead:hover {
  background: var(--mx-hover);
}

.headText {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cardName {
  font: var(--mx-font-body);
  font-weight: 600;
  color: var(--mx-text);
}

/* 卡片头副行：一句话描述（id 无意义不上屏，缺失回退 id） */
.cardDesc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.headMeta {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
}

/* chevron 折叠旋转（展开 180°） */
.chev {
  color: var(--mx-text-tertiary);
  transition: transform var(--mx-duration-fast) var(--mx-ease-standard);
}

.chevOpen {
  transform: rotate(180deg);
}

/* 展开区：元信息 + 操作 */
.cardBody {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
  padding: var(--mx-space-3);
  border-top: 0.5px solid var(--mx-separator-soft);
}

/* 元信息两列栅格：label 固定宽 + value 弹性 */
.infoGrid {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: var(--mx-space-1) var(--mx-space-3);
}

.infoLabel {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.infoValue {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  font: var(--mx-font-caption);
  color: var(--mx-text);
  word-break: break-all;
}

.repoLink {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--mx-accent);
  text-decoration: none;
}

.repoLink:hover {
  text-decoration: underline;
}

.verHost {
  position: relative;
  display: inline-flex;
}

/* 操作行：启停 + 卸载，右对齐 */
.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--mx-space-2);
  padding-top: var(--mx-space-2);
  border-top: 0.5px solid var(--mx-separator-soft);
}

.hint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  padding: var(--mx-space-2) 0;
}

.error {
  font: var(--mx-font-caption);
  color: var(--mx-state-error);
  padding: var(--mx-space-2) 0;
}
</style>
