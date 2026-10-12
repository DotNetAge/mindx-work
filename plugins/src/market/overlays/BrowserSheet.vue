<template>
  <!-- 内容居中：max-width 1024 + margin auto；iframe 自成滚动域（壳 sheetBody 不重复滚动） -->
  <div :class="$style.page">
    <iframe
      v-if="store.browserSheetUrl"
      :src="store.browserSheetUrl"
      :class="$style.frame"
      sandbox="allow-same-origin"
      title="文档"
    />
  </div>
</template>

<script setup lang="ts">
import { useMarketStore } from '../store'

const store = useMarketStore()
</script>

<style module>
.page {
  height: 100%;
  max-width: 1024px;
  margin: auto;
}

.frame {
  display: block;
  width: 100%;
  height: 100%;
  border: none;
}
</style>
