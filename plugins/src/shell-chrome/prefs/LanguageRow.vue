<script setup lang="ts">
/** 语言行（承接自 demo）：标准设置行（.mx-pref-row：label+说明左、右控件）+
 * 下拉 chip（.mx-pill，PermissionSelect 真实几何）。静态展示，暂无真实配置模型。 */
import { MxIcon } from '@mindx-work/ui-shell-vue'
</script>

<template>
  <div class="mx-pref-row">
    <div class="mx-pref-label">
      <span class="mx-pref-title">语言</span>
      <span class="mx-pref-desc">界面显示语言</span>
    </div>
    <button type="button" class="mx-pill">
      <span>中文</span>
      <MxIcon name="lucide:chevron-down" :size="16" />
    </button>
  </div>
</template>
