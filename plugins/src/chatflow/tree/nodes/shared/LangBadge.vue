<script setup lang="ts">
// 文件类型图标：复用 monaco-vscode-api 的文件图标主题（Material / Seti，随工作台设置联动）。
// 机制：workbench 主题服务按图标主题 manifest 动态注入 CSS，选择器命中
// `file-icon` + `<name>-name-file-icon` + `<ext>-ext-file-icon` 等类名组合；
// 类名算法与 vscode getIconClasses 一致（editor/common/services/getIconClasses.js），
// 容器需挂 show-file-icons 上下文类（TreeView 根已挂）。
import { computed } from 'vue'

const props = withDefaults(defineProps<{ path: string; size?: 'sm' | 'md' }>(), {
  size: 'md',
})

// 与 vscode fileIconSelectorEscape 一致：CSS 类名安全化
function selectorEscape(s: string): string {
  return s.replace(/[^a-z0-9-]/g, (c) => `\\${c}`)
}

const classes = computed(() => {
  // 取文件名（与 getIconClasses 的路径尾段提取一致）
  const match = props.path.match(/(?:\/|^)(?:([^/]+)\/)?([^/]+)$/)
  const name = selectorEscape((match?.[2] || props.path).toLowerCase())
  const result = ['file-icon', `${name}-name-file-icon`, 'name-file-icon']
  // 逐段扩展名：skill.md → `skill.md-ext-file-icon` + `md-ext-file-icon`
  const dotSegments = name.split('.')
  for (let i = 1; i < dotSegments.length; i++) {
    result.push(`${dotSegments.slice(i).join('.')}-ext-file-icon`)
  }
  result.push('ext-file-icon')
  return result
})
</script>

<template>
  <!-- 外层挂 show-file-icons 上下文类：vscode 主题 CSS 为后代选择器
       （.show-file-icons .md-ext-file-icon::before），上下文与图标类不能同元素 -->
  <span class="show-file-icons lang-badge" :class="`size-${props.size}`">
    <span class="file-type-icon" :class="classes" />
  </span>
</template>

<style scoped>
.lang-badge {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.file-type-icon {
  display: inline-block;
  flex-shrink: 0;
  /* 文件图标主题以 ::before（字体图标）或背景图（SVG 图标）呈现，居中对齐 */
  vertical-align: middle;
  line-height: 1;
}

/* 主题规则只注入 content + background-image（SVG 图标）或 content + 字体属性（字体图标），
   background 基础样式（尺寸/定位/禁止平铺）本由 .monaco-icon-label::before 提供；
   本组件脱离该上下文，必须自备，否则 SVG 背景按原始尺寸默认平铺（图标重复且变形）。
   content 一律交给主题规则：SVG 主题注入 em quad 占位、字体主题注入 fontCharacter。 */
.file-type-icon::before {
  display: inline-block;
  width: 100%;
  height: 100%;
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
}

.size-md {
  width: 16px;
  height: 16px;
}

.size-sm {
  width: 14px;
  height: 14px;
}
</style>
