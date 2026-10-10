<script setup lang="ts">
/**
 * 评分分享开关行（设置「通用」页隐私区，§2.2）：
 * market.shareRatings 缺省关——关闭时不发起评分请求、货架评分入口置灰。
 * UI 层门槛：daemon 与服务端不做二次校验（开关管用户意愿表达）。
 * 状态归 useMarketStore（货架入口同源读取），落盘经 shell.preferences。
 */
import { useMarketStore } from '../store'

const store = useMarketStore()
</script>

<template>
  <div class="mx-pref-row">
    <div class="mx-pref-label">
      <span class="mx-pref-title">分享我的评分</span>
      <span class="mx-pref-desc">开启后可在市场为包评分（1-5 星，与设备身份或市场账号关联）；关闭时评分入口置灰且不发送评分请求</span>
    </div>
    <button class="mx-switch" role="switch" :aria-checked="store.shareRatings" @click="store.setShareRatings(!store.shareRatings)">
      <span class="mx-switch-thumb" />
    </button>
  </div>
</template>
