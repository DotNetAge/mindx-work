<script setup lang="ts">
/**
 * 插件管理设置行：已安装列表（启停 / 版本切换 / 卸载）+ 插件市场（浏览与安装入口）。
 * 编排归组件：安装确认走全局 modal（Overlay.add，同 id 先 remove 再 add 的互斥惯例）；
 * 动作归 store（宿主桥调用 + 运行期启停经 services）。
 * 样式严格用 mx-uikit：原语类（mx-btn/mx-switch/mx-pill/mx-menu/mx-icon-btn）+ token。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import type { InstalledPluginView } from '@mindx-work/ui-shell'
import { MxIcon, useShell } from '@mindx-work/ui-shell-vue'
import { useMarketStore, teamPkgDisplayName, TeamExistsError } from '../store'
import type { MarketTeamPackage } from '../store'
import { OVERLAY_CONFIRM, MODAL_TEAM_CONFIRM } from '../ids'
import InstallConfirmModal from '../overlays/InstallConfirmModal.vue'
import TeamConfirmModal from '../overlays/TeamConfirmModal.vue'
import { pushNotice } from '../notice'

const store = useMarketStore()
const shell = useShell()

/** 当前展开版本菜单的插件 id（null = 全部收起） */
const verMenuFor = ref<string | null>(null)

onMounted(() => {
  void store.refreshInstalled()
  void store.refreshMarket()
  void store.loadTeamMarket()
  window.addEventListener('click', closeVerMenu)
})
onUnmounted(() => window.removeEventListener('click', closeVerMenu))

function closeVerMenu() {
  verMenuFor.value = null
}

function isInstalled(id: string): boolean {
  return store.installed.some((p) => p.id === id)
}

/** 还有未安装的市场版本：已装插件可继续安装其他版本（更新/装旧版 =
 * 落新代际 + 指针迁移）；全部版本已装才禁用 */
function hasInstallableVersion(entry: (typeof store.market)[number]): boolean {
  const record = store.installed.find((p) => p.id === entry.id)
  if (!record) return true
  return entry.versions.some((v) => !record.versions.includes(v.version))
}

function onInstall(entry: (typeof store.market)[number]) {
  store.requestConfirm(entry)
  // modal 互斥：remove 对不存在条目抛错，先 has 守卫再 remove（契约 §6 惯例）
  if (shell.Overlay.has(OVERLAY_CONFIRM)) shell.Overlay.remove(OVERLAY_CONFIRM)
  shell.Overlay.add({ id: OVERLAY_CONFIRM, kind: 'modal', component: InstallConfirmModal })
}

function onSwitchVersion(view: InstalledPluginView, version: string) {
  verMenuFor.value = null
  if (version !== view.version) void store.switchVersion(view, version)
}

function onExport(view: InstalledPluginView) {
  void store.exportPlugin(view)
}

/** modal 互斥惯例：add 前先 remove 同 id（同 onInstall） */
function openTeamConfirm() {
  if (shell.Overlay.has(MODAL_TEAM_CONFIRM)) shell.Overlay.remove(MODAL_TEAM_CONFIRM)
  shell.Overlay.add({ id: MODAL_TEAM_CONFIRM, kind: 'modal', component: TeamConfirmModal })
}

/** 团队整包安装：成功推通知（成员落位数随结果带回）；同名冲突（团队/任一成员
 * 已存在）排队覆盖确认后 overwrite 重试（agents 插件范式）。团队/员工清单的
 * 刷新由 daemon 的 teams_changed / agents_changed 广播驱动（agents 插件订阅） */
function onInstallTeam(pkg: MarketTeamPackage) {
  void store
    .installTeam(pkg)
    .then((result) => {
      const members = result.members?.length ?? 0
      pushNotice(shell, 'success', `已安装团队「${teamPkgDisplayName(pkg)}」${members > 0 ? `及 ${members} 名成员` : ''}`)
    })
    .catch((err: unknown) => {
      if (err instanceof TeamExistsError) {
        const m = err.message.match(/已存在同名(团队|智能体)\s*"([^"]+)"/)
        store.requestTeamConfirm(
          '同名冲突',
          `已存在同名${m?.[1] || '团队'}「${m?.[2] || pkg.name}」，是否覆盖？覆盖后原团队与同名成员内容将被替换，不可恢复。`,
          '覆盖安装',
          `已覆盖安装「${teamPkgDisplayName(pkg)}」`,
          () => store.installTeamPackage(pkg, true),
        )
        openTeamConfirm()
        return
      }
      pushNotice(shell, 'error', err instanceof Error ? err.message : '安装失败')
    })
}
</script>

<template>
  <div :class="$style.wrap">
    <section>
      <div :class="$style.sectionHead">
        <span :class="$style.sectionTitle">内置</span>
        <span :class="$style.count">{{ store.corePlugins.length }}</span>
      </div>
      <div v-for="core in store.corePlugins" :key="core.id" :class="$style.item">
        <div :class="$style.itemText">
          <span :class="$style.itemName">{{ core.name }}</span>
          <span :class="$style.itemVersion">{{ core.description }}</span>
        </div>
        <span class="mx-pill">内置</span>
      </div>
    </section>

    <section>
      <div :class="$style.sectionHead">
        <span :class="$style.sectionTitle">已安装</span>
        <span :class="$style.count">{{ store.installed.length }}</span>
      </div>
      <div v-for="view in store.installed" :key="view.id" :class="$style.item">
        <div :class="$style.itemText">
          <span :class="$style.itemName">{{ view.name }}</span>
          <span :class="$style.itemVersion">{{ view.id }} · {{ view.version }}</span>
        </div>
        <!-- 版本切换（多版本时呈现）：pill 触发菜单卡 -->
        <div v-if="view.versions.length > 1" :class="$style.verHost">
          <button type="button" class="mx-pill" @click.stop="verMenuFor = verMenuFor === view.id ? null : view.id">
            <span>{{ view.version }}</span>
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
        </div>
        <button
          type="button"
          class="mx-switch"
          role="switch"
          :aria-checked="view.enabled ? 'true' : 'false'"
          :disabled="store.busyId === view.id"
          @click="view.enabled ? store.disable(view) : store.enable(view)"
        >
          <span class="mx-switch-thumb" />
        </button>
        <button
          type="button"
          class="mx-icon-btn"
          aria-label="导出插件包"
          :disabled="store.busyId === view.id"
          @click="onExport(view)"
        >
          <MxIcon name="lucide:folder-output" :size="16" />
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
      <p v-if="store.installed.length === 0" :class="$style.hint">
        尚未安装在线插件，从下方市场选择安装，或导入本地插件包。
      </p>
    </section>

    <section>
      <div :class="$style.sectionHead">
        <span :class="$style.sectionTitle">插件市场</span>
        <div :class="$style.headActions">
          <button
            type="button"
            class="mx-icon-btn"
            aria-label="导入本地插件包"
            :disabled="store.busyId !== null"
            @click="store.importFromFile()"
          >
            <MxIcon name="lucide:package-plus" :size="16" />
          </button>
          <button
            type="button"
            class="mx-icon-btn"
            aria-label="刷新市场"
            :disabled="store.loadingMarket"
            @click="store.refreshMarket()"
          >
            <MxIcon name="lucide:refresh-cw" :size="16" />
          </button>
        </div>
      </div>
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
          @click="onInstall(entry)"
        >
          {{ !isInstalled(entry.id) ? '安装' : hasInstallableVersion(entry) ? '安装此版本' : '已安装' }}
        </button>
      </div>
      <p v-if="!store.hasBridge" :class="$style.hint">当前环境不支持插件市场（需要应用宿主）。</p>
    </section>

    <!-- 团队市场（mindx 市场 kind=team 团队整包；daemon 连接存在才展示） -->
    <section v-if="store.teamAvailable">
      <div :class="$style.sectionHead">
        <span :class="$style.sectionTitle">团队市场</span>
        <div :class="$style.headActions">
          <button
            type="button"
            class="mx-icon-btn"
            aria-label="刷新团队货架"
            :disabled="store.teamMarketLoading"
            @click="store.loadTeamMarket()"
          >
            <MxIcon name="lucide:refresh-cw" :size="16" />
          </button>
        </div>
      </div>
      <p v-if="store.teamMarketWarning" :class="$style.hint">{{ store.teamMarketWarning }}</p>
      <p v-if="store.teamMarketLoading && !store.teamMarketLoaded" :class="[$style.hint, 'mx-text-loading']">
        正在加载团队货架…
      </p>
      <p v-else-if="store.teamMarketError" :class="$style.error">{{ store.teamMarketError }}</p>
      <div v-for="pkg in store.teamPackages" :key="pkg.name" :class="$style.marketItem">
        <img v-if="pkg.icon" :class="$style.teamAvatar" :src="pkg.icon" :alt="teamPkgDisplayName(pkg)" />
        <span v-else :class="$style.teamAvatar">{{ (teamPkgDisplayName(pkg) || '?').charAt(0).toUpperCase() }}</span>
        <div :class="$style.itemText">
          <div :class="$style.nameRow">
            <span :class="$style.itemName">{{ teamPkgDisplayName(pkg) }}</span>
            <span class="mx-tag" data-tone="info">团队</span>
          </div>
          <span :class="$style.itemVersion">{{ pkg.name }}</span>
          <div :class="$style.tagRow">
            <span class="mx-tag" data-tone="neutral">负责人 {{ pkg.leader || '—' }}</span>
            <span class="mx-tag" data-tone="neutral">{{ (pkg.members || []).length }} 名成员</span>
          </div>
          <span :class="$style.desc">{{ pkg.description || '暂无描述' }}</span>
        </div>
        <button
          type="button"
          class="mx-btn"
          :disabled="store.installingTeam === pkg.name"
          @click="onInstallTeam(pkg)"
        >
          <span v-if="store.installingTeam === pkg.name" class="mx-text-loading">安装中…</span>
          <template v-else>安装</template>
        </button>
      </div>
      <p
        v-if="store.teamMarketLoaded && store.teamPackages.length === 0 && !store.teamMarketError"
        :class="$style.hint"
      >
        团队货架暂无可安装的团队整包。
      </p>
    </section>

    <p v-if="store.lastError" :class="$style.error">{{ store.lastError }}</p>
  </div>
</template>

<style module>
/* 行容器：单行占满设置页内容区，纵向两节 */
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-6);
  padding: var(--mx-space-4) 0;
}

.sectionHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--mx-space-2);
}

/* 节头动作组：导入 + 刷新按钮 */
.headActions {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
}

.sectionTitle {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.count {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

/* 已安装行：文本列 + 版本菜单 + 开关 + 卸载 */
.item {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-2) 0;
}

.itemText {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.itemName {
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.itemVersion {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.desc {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
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

/* 版本菜单宿主（mx-menu 定位要求宿主 relative） */
.verHost {
  position: relative;
}

/* 市场条目卡：文本列 + 安装按钮 */
.marketItem {
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
  padding: var(--mx-space-3);
  border: 0.5px solid var(--mx-separator-soft);
  border-radius: var(--mx-radius-card);
  background: var(--mx-bg-surface);
}

.marketItem + .marketItem {
  margin-top: var(--mx-space-2);
}

/* 团队卡头像：圆形，首字回退（对齐团队招聘区卡片口径） */
.teamAvatar {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--mx-module);
  font: var(--mx-font-heading);
  color: var(--mx-text-secondary);
  object-fit: cover;
}

/* 展示名 + 团队标识同行 */
.nameRow {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
}

/* 负责人 / 成员数标签行 */
.tagRow {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  flex-wrap: wrap;
}
</style>
