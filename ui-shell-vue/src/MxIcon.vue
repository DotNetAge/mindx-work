<script setup lang="ts">
import { addCollection, Icon } from '@iconify/vue'
// 常用集合预打包作离线兜底（样式原语第 6 节）；其余集合经 Iconify API 在线加载
// @ts-ignore 图标数据体积大，跳过完整 JSON 类型化
import lucideIcons from '@iconify-json/lucide/icons.json'

addCollection(lucideIcons)

// 图标纪律归壳（军规 9）：名称即接口，统一 currentColor，尺寸 16 / 20 两档
withDefaults(defineProps<{ name: string; size?: 16 | 20 }>(), { size: 16 })
</script>

<template>
  <Icon :icon="name" :width="size" :height="size" aria-hidden="true" />
</template>
