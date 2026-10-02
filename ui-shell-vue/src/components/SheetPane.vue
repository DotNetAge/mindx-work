<script setup lang="ts">
/**
 * SheetPane：全屏抽层（契约第 4 节 Sheet 视图区）。
 * 由下向上滑入覆盖整个界面，头部为壳固有 chrome：注册者提供的 Title 居中、
 * 尾端固有关闭钮（关闭 = 移除条目，同 banner 固有关闭控件先例）。
 * 条目在注册表中即呈现，互斥单开（核心层强制，冲突抛错）。
 */
import { onMounted, onUnmounted } from 'vue'
import { useShell, useShellData } from '../reactivity'
import MxIcon from '../MxIcon.vue'

const shell = useShell()
const data = useShellData(() => shell.Sheet.entries[0] ?? null)

/** Esc 分层：sheet（z-index 62）之下是设置面板（60）、之上是通知（65）与 modal（70）。
 * modal 在场时最上层是 modal，Esc 归 OverlayPane 认领（本层不处理）；
 * 更高层已认领（event 已 preventDefault）同样不处理——一次 Esc 只关一层 */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (event.defaultPrevented) return
  if (shell.Overlay.entries.some((entry) => entry.kind === 'modal')) return
  const sheet = data.value
  if (!sheet) return
  shell.Sheet.remove(sheet.id)
  event.preventDefault()
}
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <!-- Transition 只负责退场：leave 动画播完（animationend）才真正卸载；
    入场由元素自身 animation 驱动，无需 enter class（对齐 OverlayPane 模式） -->
  <Transition :leave-active-class="$style.sheetLeaveActive">
    <div v-if="data" :class="$style.sheetRoot">
      <header :class="$style.sheetHeader">
        <!-- Title 绝对居中（左右控件宽度不等时不偏移） -->
        <div :class="$style.sheetTitle">{{ data.title }}</div>
        <!-- 壳机制固有的关闭控件：关闭 = 移除条目（sheetClose 管布局，
          mx-icon-btn 全局类管观感——模块样式引用全局类会被哈希失配，故分立） -->
        <button
          type="button"
          :class="$style.sheetClose"
          class="mx-icon-btn"
          aria-label="关闭"
          @click="shell.Sheet.remove(data.id)"
        >
          <MxIcon name="lucide:x" :size="16" />
        </button>
      </header>
      <div :class="$style.sheetBody">
        <component :is="data.component" />
      </div>
    </div>
  </Transition>
</template>

<style module>
/* 全屏抽层根：覆盖整个界面（inset 0），elevated 底对齐浮层族（modal 卡 / 设置面板）；
 * z-index 62：设置面板（60）之上——设置行内唤起的 sheet 必须盖住设置；
 * 通知（65）与 modal（70）之下——sheet 内动作触发的通知与确认框必须可见 */
.sheetRoot {
  position: fixed;
  inset: 0;
  z-index: 62;
  display: flex;
  flex-direction: column;
  background: var(--mx-bg-elevated);
  animation: sheet-in var(--mx-duration-motion) var(--mx-ease-standard);
}

/* 头部（壳固有 chrome）：54px 对齐设置面板 header 几何 */
.sheetHeader {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  height: 54px;
  padding: 0 14px;
  box-sizing: border-box;
}

/* Title 居中：绝对定位水平居中，长标题截断（不与尾端关闭钮重叠） */
.sheetTitle {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  max-width: calc(100% - 120px);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  color: var(--mx-text);
}

/* 关闭钮贴尾端（右侧） */
.sheetClose {
  margin-left: auto;
}

/* 本体：注册者组件填充剩余空间，超高滚动 */
.sheetBody {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* 入场：由下向上滑入覆盖界面（Drawer 语义） */
@keyframes sheet-in {
  from {
    transform: translateY(100%);
  }
  to {
    transform: none;
  }
}

/* 退场 = 入场倒放：向下滑出 */
@keyframes sheet-out {
  from {
    transform: none;
  }
  to {
    transform: translateY(100%);
  }
}

/* 退场挂载类：Transition 加在抽层根元素上，animationend 后才真正卸载。
 * 置于文件末尾以覆盖常驻入场动画（同 specificity 后定义者胜） */
.sheetLeaveActive {
  animation: sheet-out var(--mx-duration-motion) var(--mx-ease-standard) forwards;
}

/* 动效只用于状态过渡；偏好减弱动效时关闭入场/退场动画（退场无动画时长即瞬时卸载） */
@media (prefers-reduced-motion: reduce) {
  .sheetRoot,
  .sheetLeaveActive {
    animation: none;
  }
}
</style>
