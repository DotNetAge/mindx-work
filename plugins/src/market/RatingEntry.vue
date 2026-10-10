<script setup lang="ts">
/**
 * 货架评分显示 + 入口（§2.3，货架卡片与已装行共用）：
 * 有评分时显示 `★4.6 (23)`，无评分时显示空心星标——同一元素即展示即入口。
 * 门槛链：开关关（market.shareRatings）→ 置灰禁用；开关开未绑定 → 打开市场账号
 * Sheet 引导绑定；已绑定 → 打开 1-5 星评分 modal。
 */
import { computed } from 'vue'
import { useShell } from '@mindx-work/ui-shell-vue'
import { useMarketStore, pkgDisplayName, type MarketPkg } from './store'
import RatingModal from './overlays/RatingModal.vue'
import AccountSheet from './overlays/AccountSheet.vue'
import { MODAL_RATING, SHEET_ACCOUNT } from './ids'

const props = defineProps<{ pkg: MarketPkg }>()

const store = useMarketStore()
const shell = useShell()

const rated = computed(() => (props.pkg.rating_count ?? 0) > 0)

const starTitle = computed(() => {
  if (!store.shareRatings) return '在 设置 → 通用 → 分享我的评分 开启后可评分'
  if (!store.account?.user) return '绑定市场账号后可评分'
  return `为「${pkgDisplayName(props.pkg)}」评分`
})

function onClick(): void {
  if (!store.account?.user) {
    if (shell.Sheet.has(SHEET_ACCOUNT)) shell.Sheet.remove(SHEET_ACCOUNT)
    shell.Sheet.add({ id: SHEET_ACCOUNT, title: '市场账号', component: AccountSheet as never })
    return
  }
  store.requestRatingDialog(props.pkg)
  if (shell.Overlay.has(MODAL_RATING)) shell.Overlay.remove(MODAL_RATING)
  shell.Overlay.add({ id: MODAL_RATING, kind: 'modal', component: RatingModal as never })
}

/** 下载量人性化展示（≥1 万 → x.x 万） */
function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`
  return String(n)
}
</script>

<template>
  <div :class="$style.row">
    <button
      type="button"
      :class="$style.star"
      :data-rated="rated ? 'true' : 'false'"
      :disabled="!store.shareRatings"
      :title="starTitle"
      @click="onClick"
    >
      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
        <path
          d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.44 6.2 20.5l1.1-6.47L2.6 9.45l6.5-.95L12 2.6z"
          :fill="rated ? 'currentColor' : 'none'"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
        />
      </svg>
      <span v-if="rated">{{ (pkg.rating_avg ?? 0).toFixed(1) }} ({{ pkg.rating_count }})</span>
    </button>
    <span v-if="(pkg.download_count ?? 0) > 0" :class="$style.downloads">{{ formatCount(pkg.download_count ?? 0) }} 下载</span>
  </div>
</template>

<style module>
.row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
}

.star {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--mx-warning);
  font: var(--mx-font-caption);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.star[data-rated='false'] {
  color: var(--mx-text-tertiary);
}

.star:hover:not(:disabled) {
  background: var(--mx-hover);
}

.star:disabled {
  cursor: default;
  opacity: 0.55;
}

.star:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: 1px;
}

.downloads {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  font-variant-numeric: tabular-nums;
}
</style>
