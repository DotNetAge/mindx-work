<script setup lang="ts">
/** 字号大小行（承接自 demo，对齐 DSH FontSizeRow.module.css 真实几何）：
 * 行（L5-20）：gap 8 / padding 16 0 / 文本列 gap 4 / padding-right 48；
 * 步进胶囊（L45-54）：min-width 72 / 高 36 / radius 18 / module 底，值居中 tabular-nums；
 * 箭头列（L75-87）：绝对定位 right 8 / 缺省 opacity 0、hover 与 focus-within 显示
 * （用 opacity 而非 visibility——按钮保持可聚焦，键盘 focus 也能唤出）；
 * 箭头 chip（L92-104）：17x12 / radius 3 / layer-1 75% 洗色、hover 全 layer-1。
 * 字号值经 shell.preferences 服务持久化（键 shell-chrome.font-size），重启后恢复——
 * 插件消费内置持久化的范式：行组件只 get/set，落盘机制归壳。 */
import { ref } from 'vue'
import { useService, type PreferencesController } from '@mindx-work/ui-shell-vue'

const preferences = useService<PreferencesController>('shell.preferences')

const MIN = 12
const MAX = 18
const value = ref(preferences.get('shell-chrome.font-size', 14))
// 读回晚于本组件挂载时（在线插件先激活），以落盘值校正
void preferences.ready.then(() => {
  value.value = preferences.get('shell-chrome.font-size', value.value)
})

function step(delta: number) {
  value.value = Math.min(MAX, Math.max(MIN, value.value + delta))
  preferences.set('shell-chrome.font-size', value.value)
}
</script>

<template>
  <div :class="$style.row">
    <div :class="$style.rowText">
      <span :class="$style.title">字号大小</span>
      <span :class="$style.desc">仅影响会话内容的字号</span>
    </div>
    <div :class="$style.control">
      <div :class="$style.stepper">
        <span :class="$style.value">{{ value }}</span>
        <div :class="$style.arrows">
          <button
            type="button"
            :class="$style.arrow"
            aria-label="增大字号"
            :disabled="value >= MAX"
            @click="step(2)"
          >
            <span :class="$style.arrowGlyph" data-dir="up" aria-hidden="true" />
          </button>
          <button
            type="button"
            :class="$style.arrow"
            aria-label="减小字号"
            :disabled="value <= MIN"
            @click="step(-2)"
          >
            <span :class="$style.arrowGlyph" data-dir="down" aria-hidden="true" />
          </button>
        </div>
      </div>
      <span :class="$style.unit">px</span>
    </div>
  </div>
</template>

<style module>
/* 行（L5-20）：gap 8 / padding 16 0（分隔线由设置面板行容器统一提供） */
.row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: 16px 0;
}

.rowText {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  padding-right: 48px;
}

.title {
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.desc {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.control {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-2);
}

/* 步进胶囊（L45-54）：min-width 72 / 高 36 / radius 18 / module 底 */
.stepper {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  height: 36px;
  border-radius: 18px;
  background: var(--mx-module);
}

/* 值（L56-63）：居中 + tabular-nums 防跳动 */
.value {
  min-width: 18px;
  text-align: center;
  font: var(--mx-font-body);
  font-variant-numeric: tabular-nums;
  color: var(--mx-text);
}

/* 单位（L65-69）：胶囊外 secondary 墨色 */
.unit {
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
}

/* 箭头列（L75-87）：贴右锚定，hover / focus-within 显现 */
.arrows {
  position: absolute;
  right: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  opacity: 0;
}

.stepper:hover .arrows,
.stepper:focus-within .arrows {
  opacity: 1;
}

/* 箭头 chip（L92-113）：17x12 / radius 3 / layer-1 75% 洗色 */
.arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 12px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: color-mix(in srgb, var(--mx-bg-window) 75%, transparent);
  color: var(--mx-text);
  cursor: pointer;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.arrow:hover:not(:disabled) {
  background: var(--mx-bg-window);
}

/* 步进箭头几何（chip 内 10px 定稿）：纯 CSS chevron，非语义图标（图标军规两档不适用装饰几何） */
.arrowGlyph {
  width: 6px;
  height: 6px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg) translateY(-1px);
}

.arrowGlyph[data-dir='up'] {
  transform: rotate(-135deg) translateY(-1px);
}

.arrow:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -1px;
}

.arrow:disabled {
  color: var(--mx-text-caption);
  cursor: default;
}
</style>
