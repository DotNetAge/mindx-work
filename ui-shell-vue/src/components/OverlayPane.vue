<script setup lang="ts">
/**
 * OverlayPane：全局浮层（契约第 8 节编排语义 2）。
 * 只有 modal（互斥，遮罩 + 居中卡片）与 banner（顶部可堆叠）；
 * 条目在注册表中即呈现，关闭 = 移除。
 */
import { onMounted, onUnmounted } from 'vue'
import { useShell, useShellData } from '../reactivity'
import MxIcon from '../MxIcon.vue'

const shell = useShell()
const data = useShellData(() => ({
  banners: shell.Overlay.entries.filter((entry) => entry.kind === 'banner'),
  modal: shell.Overlay.entries.find((entry) => entry.kind === 'modal') ?? null,
}))

/** Esc 分层（契约 §14 层级表）：modal（z-index 70）在设置面板（60）之上，
 * Esc 先关最上层的 modal，不得穿透关闭下层面板。捕获期监听 + 停止传播，
 * 使设置面板的 Esc 监听（冒泡期）在 modal 存在时不会被触发 */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  const modal = data.value.modal
  if (!modal) return
  shell.Overlay.remove(modal.id)
  event.preventDefault()
  event.stopPropagation()
}
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div v-if="data.banners.length" :class="$style.banners">
    <div v-for="banner in data.banners" :key="banner.id" :class="$style.bannerCard">
      <component :is="banner.component" />
      <!-- 壳机制固有的关闭控件：关闭 = 移除条目 -->
      <button
        type="button"
        class="mx-icon-btn"
        aria-label="关闭通知"
        @click="shell.Overlay.remove(banner.id)"
      >
        <MxIcon name="lucide:x" :size="16" />
      </button>
    </div>
  </div>
  <div v-if="data.modal" :class="$style.modalMask">
    <div :class="$style.modalCard">
      <component :is="data.modal.component" />
    </div>
  </div>
</template>

<style module>
.banners {
  position: fixed;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  z-index: 40;
  animation: overlay-in var(--mx-duration-motion) var(--mx-ease-standard);
}

.bannerCard {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-2) var(--mx-space-3);
  background: var(--mx-bg-elevated);
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-card);
  box-shadow: 0 4px 16px color-mix(in srgb, var(--mx-text) 16%, transparent);
}

/* 遮罩：对齐设置页双层模糊标准——bg-mask token 底色 + mask-blur 背景高斯模糊，
 * 后方内容透过遮罩呈现柔焦；禁止只用半透明色（遮挡层无模糊 = 与设置页观感割裂）。
 * z-index 70：modal 是互斥阻塞层，必须高于设置面板（60）——设置面板内打开的
 * 确认 modal 曾被面板盖住（50 < 60），点击穿透到面板行区 */
.modalMask {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: var(--mx-mask);
  backdrop-filter: var(--mx-mask-blur);
  z-index: 70;
  animation: fade-in var(--mx-duration-motion) var(--mx-ease-standard);
}

.modalCard {
  min-width: 360px;
  max-width: min(520px, calc(100vw - var(--mx-space-7) * 2));
  padding: var(--mx-space-6);
  background: var(--mx-bg-elevated);
  border-radius: var(--mx-radius-window);
  box-shadow: 0 8px 32px color-mix(in srgb, var(--mx-text) 24%, transparent);
  animation: overlay-in var(--mx-duration-motion) var(--mx-ease-standard);
}

@keyframes overlay-in {
  from {
    opacity: 0;
    transform: translateY(-8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* 动效只用于状态过渡；偏好减弱动效时关闭入场动画 */
@media (prefers-reduced-motion: reduce) {
  .banners,
  .modalMask,
  .modalCard {
    animation: none;
  }
}
</style>
