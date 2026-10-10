<script setup lang="ts">
/**
 * 包评分 modal（纯内容组件：卡片壳由 Overlay 容器提供，§2.3）。
 * 1-5 星轻量评分，不做文字评价；打开时回显当前身份的已有评分，
 * 提交走 market.rate，成功后本地聚合列由 store 同步、货架即时刷新。
 * 评分挂包级（kind+name），不区分版本。
 */
import { computed, ref, watch } from 'vue'
import { useShell } from '@mindx-work/ui-shell-vue'
import { useMarketStore, pkgDisplayName } from '../store'
import { pushNotice } from '../notice'

const store = useMarketStore()
const shell = useShell()

const hoverScore = ref(0)
const myScore = ref(0)
const submitting = ref(false)
const submitError = ref('')

const visible = computed(() => store.ratingTarget !== null)
const pkg = computed(() => store.ratingTarget)

/** 打开时回显当前评分（rated=false 归一为 0 = 未评） */
watch(visible, (v) => {
  if (!v) return
  hoverScore.value = 0
  myScore.value = 0
  submitError.value = ''
  if (!pkg.value) return
  void store.getMyRating(pkg.value.kind, pkg.value.name).then((res) => {
    myScore.value = res.rated ? res.score : 0
  }).catch(() => {
    /* 回显失败不阻断：按未评过处理 */
  })
})

/** 提交分值：hover 预览优先，落定为已选分 */
function commit(score: number): void {
  if (!pkg.value || submitting.value) return
  submitting.value = true
  submitError.value = ''
  const name = pkgDisplayName(pkg.value)
  void store.rate(pkg.value.kind, pkg.value.name, score)
    .then(() => {
      pushNotice(shell, 'success', `已为「${name}」评分 ${score} 星`)
      close()
    })
    .catch((err: unknown) => {
      submitError.value = err instanceof Error ? err.message : '评分失败，请重试'
    })
    .finally(() => {
      submitting.value = false
    })
}

function close(): void {
  store.cancelRatingDialog()
}
</script>

<template>
  <div v-if="visible && pkg" :class="$style.body">
    <span :class="$style.title">为「{{ pkgDisplayName(pkg) }}」评分</span>
    <p :class="$style.desc">评分挂在包整体上，不区分版本；你的评分会更新到下方均分。</p>

    <div :class="$style.stars" role="radiogroup" aria-label="评分星级">
      <button
        v-for="n in 5"
        :key="n"
        type="button"
        role="radio"
        :aria-checked="(hoverScore || myScore) >= n ? 'true' : 'false'"
        :aria-label="`${n} 星`"
        :class="$style.star"
        :data-on="(hoverScore || myScore) >= n ? 'true' : 'false'"
        :disabled="submitting"
        @mouseenter="hoverScore = n"
        @mouseleave="hoverScore = 0"
        @click="commit(n)"
      >
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
          <path
            d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.44 6.2 20.5l1.1-6.47L2.6 9.45l6.5-.95L12 2.6z"
            :fill="(hoverScore || myScore) >= n ? 'currentColor' : 'none'"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>

    <p v-if="(pkg.rating_count ?? 0) > 0" :class="$style.agg">
      当前 {{ (pkg.rating_avg ?? 0).toFixed(1) }} 分（{{ pkg.rating_count }} 人评分）
    </p>

    <p v-if="submitError" :class="$style.error">{{ submitError }}</p>

    <div :class="$style.actions">
      <button type="button" class="mx-btn" :disabled="submitting" @click="close">取消</button>
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
  margin: 0;
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
}

.stars {
  display: flex;
  justify-content: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-2) 0;
}

.star {
  display: inline-flex;
  padding: 2px;
  border: none;
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
  transform: scale(1.12);
}

.star:disabled {
  cursor: default;
  opacity: 0.7;
}

.star:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: 2px;
  border-radius: 4px;
}

.agg {
  margin: 0;
  text-align: center;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.error {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-state-error);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
}
</style>
