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
import { useMarketStore } from '../store'
import { OVERLAY_CONFIRM } from '../ids'
import InstallConfirmModal from '../overlays/InstallConfirmModal.vue'

const store = useMarketStore()
const shell = useShell()

/** 当前展开版本菜单的插件 id（null = 全部收起） */
const verMenuFor = ref<string | null>(null)

onMounted(() => {
  void store.refreshInstalled()
  void store.refreshMarket()
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
</script>

<template>
  <div :class="$style.wrap">
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
          aria-label="卸载"
          :disabled="store.busyId === view.id"
          @click="store.uninstall(view)"
        >
          <MxIcon name="lucide:trash-2" :size="16" />
        </button>
      </div>
      <p v-if="store.installed.length === 0" :class="$style.hint">
        尚未安装在线插件，从下方市场选择安装。
      </p>
    </section>

    <section>
      <div :class="$style.sectionHead">
        <span :class="$style.sectionTitle">插件市场</span>
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
</style>
