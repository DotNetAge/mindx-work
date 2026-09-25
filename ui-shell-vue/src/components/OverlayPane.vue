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
  <!-- Transition 只负责退场：leave 动画播完（animationend）才真正卸载；
    入场由元素自身 animation 驱动，无需 enter class -->
  <Transition :leave-active-class="$style.modalLeaveActive">
    <div v-if="data.modal" :class="$style.modalMask">
      <div :class="$style.modalCard">
        <component :is="data.modal.component" />
      </div>
    </div>
  </Transition>
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
  /* 边界靠 shadow-lv3 首段 1px 实色描边（锐利边界）——曾用 text 色手拼 32px 大扩散光晕，
   * 暗色主题 text 近白导致卡片边缘一圈白雾、边界感不清晰 */
  box-shadow: var(--mx-shadow-lv3);
  animation: modal-in var(--mx-duration-motion) var(--mx-ease-standard);
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

/* modal 入场：仿 Apple 从小到大放大（0.82 → 1）+ 上浮，标准减速曲线 */
@keyframes modal-in {
  from {
    opacity: 0;
    transform: translateY(-12px) scale(0.82);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* modal 退场 = 入场倒放：遮罩淡出 + 卡片缩小上浮淡出（同曲线同时长） */
@keyframes mask-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

@keyframes card-out {
  from {
    opacity: 1;
    transform: none;
  }
  to {
    opacity: 0;
    transform: translateY(-12px) scale(0.82);
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

/* modal 退场挂载类：Transition 加在遮罩根元素上，animationend 后才真正卸载；
 * 卡片退场经后代选择器触发——两动画同曲线同时长同帧结束，卸载时机以根元素为准。
 * 置于文件末尾以覆盖常驻入场动画（同 specificity 后定义者胜） */
.modalLeaveActive {
  animation: mask-out var(--mx-duration-motion) var(--mx-ease-standard) forwards;
}
.modalLeaveActive .modalCard {
  animation: card-out var(--mx-duration-motion) var(--mx-ease-standard) forwards;
}

/* 动效只用于状态过渡；偏好减弱动效时关闭入场/退场动画（退场无动画时长即瞬时卸载） */
@media (prefers-reduced-motion: reduce) {
  .banners,
  .modalMask,
  .modalCard,
  .modalLeaveActive {
    animation: none;
  }
}
</style>
