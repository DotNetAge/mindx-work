<script setup lang="ts">
/**
 * 账户设置页（整页主体）：响应式分流内嵌——
 * 已登录内嵌 AccountSheet（仿「Apple 账户」档案与设备列表）；
 * 未登录内嵌 AuthRequiredSheet（登录/注册遮挡页；登录成功后 user 置位自动切回档案视图）。
 * 与市场内账号 Sheet 同源同 UI。自动注册常态下直达档案视图。
 * 页内不再渲染「账户」标题（导航选中态已表达位置；二级操作由 AccountSheet 内后退箭头引领）。
 * 2026-10-10 账号机制简化定案重做（旧 GitHub OAuth 档案页随用户名密码机制退役）。
 */
import { useMarketStore } from '../store'
import AccountSheet from '../overlays/AccountSheet.vue'
import AuthRequiredSheet from '../overlays/AuthRequiredSheet.vue'

const store = useMarketStore()
</script>

<template>
  <div :class="$style.wrap">
    <p v-if="store.accountLoading && !store.account" class="mx-text-loading">正在获取账号状态…</p>
    <AccountSheet v-else-if="store.account?.user" />
    <AuthRequiredSheet v-else />
  </div>
</template>

<style module>
.wrap {
  display: flex;
  flex-direction: column;
  padding: var(--mx-space-4) 0;
}
</style>
