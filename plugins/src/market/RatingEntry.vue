<script setup lang="ts">
/**
 * 货架行内评分（§2.3，货架卡片与已装行共用）：
 * 五颗星直接点选提交，不弹窗——点第 n 颗星即提交 n 星评分，成功后
 * 本地聚合列由 store 同步、货架即时刷新。评分挂包级（kind+name），不区分版本。
 * 未绑定账号时点击 → 打开 MindX 账号 Sheet 引导绑定（评分行为不设限，
 * 数据是否上传由「分享我的评分」授权在提交时把关）。
 */
import { computed, ref, watch } from 'vue'
import { useShell } from '@mindx-work/ui-shell-vue'
import { useMarketStore, pkgDisplayName, type MarketPkg } from './store'
import { pushNotice } from './notice'
import { openAccountSheet } from './overlays/accountSheets'

const props = defineProps<{ pkg: MarketPkg }>()

const store = useMarketStore()
const shell = useShell()

const hoverScore = ref(0)
const myScore = ref(0)
const submitting = ref(false)

/** 星星填充：hover 预览优先，落定为已选分 */
const fill = computed(() => hoverScore.value || myScore.value)
const rated = computed(() => (props.pkg.rating_count ?? 0) > 0)

/** 回显当前身份已有评分（rated=false 归一为 0 = 未评；回显失败按未评过处理） */
watch(
  () => [props.pkg.kind, props.pkg.name] as const,
  ([kind, name]) => {
    myScore.value = 0
    void store.getMyRating(kind, name).then((res) => {
      myScore.value = res.rated ? res.score : 0
    }).catch(() => {
      /* 回显失败不阻断 */
    })
  },
  { immediate: true },
)

/** 点星即评分：未绑定拉账号引导，同分不重复提交，成功更新本地回显并推通知 */
function pick(score: number): void {
  if (submitting.value) return
  if (!store.account?.user) {
    void openAccountSheet(shell, store)
    return
  }
  if (score === myScore.value) return
  const name = pkgDisplayName(props.pkg)
  submitting.value = true
  void store.rate(props.pkg.kind, props.pkg.name, score)
    .then(() => {
      myScore.value = score
      pushNotice(shell, 'success', `已为「${name}」评分 ${score} 星`)
    })
    .catch((err: unknown) => {
      pushNotice(shell, 'error', err instanceof Error ? err.message : '评分失败，请重试')
    })
    .finally(() => {
      submitting.value = false
    })
}

/** 下载量人性化展示（≥1 万 → x.x 万） */
function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`
  return String(n)
}
</script>

<template>
  <span :class="$style.rating">
    <span
      :class="$style.stars"
      role="radiogroup"
      :aria-label="`为「${pkgDisplayName(pkg)}」评分`"
      :data-busy="submitting ? 'true' : 'false'"
    >
      <button
        v-for="n in 5"
        :key="n"
        type="button"
        role="radio"
        :aria-checked="fill >= n ? 'true' : 'false'"
        :aria-label="`${n} 星`"
        :class="$style.star"
        :data-on="fill >= n ? 'true' : 'false'"
        :disabled="submitting"
        @mouseenter="hoverScore = n"
        @mouseleave="hoverScore = 0"
        @click="pick(n)"
      >
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
          <path
            d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.44 6.2 20.5l1.1-6.47L2.6 9.45l6.5-.95L12 2.6z"
            :fill="fill >= n ? 'currentColor' : 'none'"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </span>
    <span v-if="rated" :class="$style.agg">{{ (pkg.rating_avg ?? 0).toFixed(1) }} ({{ pkg.rating_count }})</span>
    <span v-if="(pkg.download_count ?? 0) > 0" :class="$style.downloads">{{ formatCount(pkg.download_count ?? 0) }} 下载</span>
  </span>
</template>

<style module>
.rating {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-2);
}

.stars {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}

.stars[data-busy='true'] {
  opacity: 0.7;
}

.star {
  display: inline-flex;
  padding: 2px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--mx-warning);
  cursor: pointer;
  transition: transform var(--mx-duration-fast) var(--mx-ease-standard);
}

.star[data-on='false'] {
  color: var(--mx-text-tertiary);
  opacity: 0.55;
}

.star:hover {
  transform: scale(1.15);
}

.star:disabled {
  cursor: default;
}

.star:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: 1px;
}

.agg,
.downloads {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  font-variant-numeric: tabular-nums;
}
</style>
