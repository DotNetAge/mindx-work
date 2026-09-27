<script setup lang="ts">
// 未配置任何模型时的输入区占位（源：mindx-desktop ChatInput/NoModel.vue 平移，文案已是中文字面量）：
// 整块替换 ChatInput 的正常输入框，仅提供一个「打开模型设置」按钮。
// work 适配：desktop 的 open-model-settings 走 showModelPicker 链路打开模型管理；
// work models 插件注册期未安装、暂未暴露 services——通道预留，宿主层打桩（四期接线）。
const emit = defineEmits<{
  (e: 'open-model-settings'): void
}>()
</script>

<template>
  <div class="no-model">
    <div class="no-model-txt">
      <p class="main">还未配置任何模型</p>
      <p class="sub">请先配置模型后再开始对话</p>
    </div>
    <el-button type="primary" size="large" @click="emit('open-model-settings')">
      打开模型设置
    </el-button>
  </div>
</template>

<style scoped>
.no-model {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--mx-space-4);
  padding: var(--mx-space-7);
  background: var(--mx-bg-elevated);
  border: 1px solid color-mix(in srgb, var(--mx-separator) 70%, transparent);
  border-radius: var(--mx-radius-card);
}

.no-model-txt {
  text-align: center;
}

.main {
  margin: 0 0 var(--mx-space-2);
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.sub {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}
</style>
