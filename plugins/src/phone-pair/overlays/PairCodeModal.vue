<script setup lang="ts">
/**
 * 配对短码弹窗（纯内容组件，卡片壳由 Overlay 容器提供）：蓝本 PhonePairDialogs 短码框。
 * 大号等宽短码（可选中复制）+ 配对二维码 + 有效期倒计时；倒计时归零自动关闭
 * （蓝本 gateCountdown 同款 1s 递减）。短码与初值由引擎在 pair_approved 时写入
 * 模块级状态。二维码内容 mindx://pair?code=<短码>（URL 形式留扩展位），手机端
 * MindX 扫码后自动填入校验，免手动输入；短码 5 分钟内静态不变（daemon 仅过期
 * 重签），二维码无需刷新机制。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import QRCode from 'qrcode'
import { useShell } from '@mindx-work/ui-shell-vue'
import { gateCode, gateExpiresIn } from '../engine'
import { MODAL_PHONE_PAIR_CODE } from '../ids'

const shell = useShell()

/** 倒计时秒数：初值取引擎写入的有效期（弹窗每次打开重新挂载） */
const countdown = ref(gateExpiresIn.value || 300)
/** 二维码 SVG 字符串（qrcode 库生成，输入仅含 6 位数字码，无注入面） */
const qrSvg = ref('')
let timer: ReturnType<typeof setInterval> | null = null

/** 生成配对二维码（失败静默保留短码输入路径，不阻断配对） */
async function renderQr(): Promise<void> {
  if (!gateCode.value) return
  try {
    qrSvg.value = await QRCode.toString(`mindx://pair?code=${gateCode.value}`, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
    })
  } catch {
    qrSvg.value = ''
  }
}

function close(): void {
  shell.Overlay.remove(MODAL_PHONE_PAIR_CODE)
}

onMounted(() => {
  void renderQr()
  timer = setInterval(() => {
    if (countdown.value > 0) {
      countdown.value -= 1
      if (countdown.value === 0) close()
    }
  }, 1000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div :class="$style.body">
    <span :class="$style.title">手机配对</span>
    <p :class="$style.desc">在手机端 MindX 扫码填入，或手动输入以下短码：</p>
    <!-- 二维码：白底内衬（二维码需浅底深码，深色主题下固定白底保证可扫） -->
    <div v-if="qrSvg" :class="$style.qrWrap" v-html="qrSvg" />
    <div :class="$style.code">{{ gateCode }}</div>
    <p :class="$style.countdown">{{ countdown }}s 内有效，过期后在手机上重试将生成新短码</p>
    <div :class="$style.actions">
      <button type="button" class="mx-btn" @click="close">关闭</button>
    </div>
  </div>
</template>

<style module>
.body {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
}

.title {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.desc {
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
  margin: 0;
  text-align: center;
}

/* 二维码：白底圆角内衬卡，浅底深码保证任何主题下可扫 */
.qrWrap {
  align-self: center;
  width: 160px;
  padding: var(--mx-space-2);
  border-radius: var(--mx-radius-card);
  background: #ffffff;
}

.qrWrap :global(svg) {
  display: block;
  width: 100%;
  height: auto;
}

/* 短码：等宽大字 + 宽字距（蓝本 40px/700/字距 12px/可选中）；壳无 mono token，用系统等宽栈 */
.code {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 40px;
  font-weight: 700;
  letter-spacing: 12px;
  text-align: center;
  color: var(--mx-text);
  padding: var(--mx-space-2) 0;
  user-select: text;
}

.countdown {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  margin: 0;
  text-align: center;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
}
</style>
