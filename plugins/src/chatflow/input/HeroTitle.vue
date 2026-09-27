<script setup lang="ts">
/**
 * HeroTitle —— 空会话 hero 标题（概念框架 §7 定稿；desktop 无源，新写）。
 * 形态对齐 DeepSeek Harness「主区居中 hero」：官方 Logo glyph（单色 mask 取形，
 * 填充跟随 --mx-text，双主题一份资源）+ 标题「探索人机共生的新时代」+ beta 上标。
 * 仅空会话（零轮）时由 ChatFlowPage 渲染于 Content 中部，首条消息发送后随 hero 消失。
 */
</script>

<template>
  <div class="hero-title">
    <span role="img" aria-label="MindX" class="hero-logo"></span>
    <h1 class="hero-heading">探索人机共生的新时代<sup class="hero-beta">beta</sup></h1>
  </div>
</template>

<style scoped>
.hero-title {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--mx-space-3);
}

/* 官方 logo 单色 glyph：mask 取形（同 shell-chrome/ChromeHeader 先例），44px 高。
   路径注意：本组件在 input/ 下，assets/ 在插件根 chatflow/assets/，相对路径一层
   上行（../../ 会指到 plugins/src/assets/ 不存在，Vite 对不可解析 url 原样保留，
   运行时落到 SPA 回退 HTML → mask 解码失败整体透明，三期验收实测踩坑） */
.hero-logo {
  display: block;
  height: 44px;
  width: calc(44px * 648 / 577);
  background-color: var(--mx-text);
  mask: url('../assets/logo.svg') no-repeat center / contain;
  -webkit-mask: url('../assets/logo.svg') no-repeat center / contain;
}

.hero-heading {
  margin: 0;
  font-size: 26px;
  line-height: 36px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--mx-text);
  text-align: center;
}

/* beta 上标：弱化三层文字色，随主标题基线上标 */
.hero-beta {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: var(--mx-text-tertiary);
}
</style>
