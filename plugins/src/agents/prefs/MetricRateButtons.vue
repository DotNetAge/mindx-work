<script setup lang="ts">
// MetricRateButtons —— 管理页整体评价双指（白皮书《决策量表》7.2 辅收集）。
// 限频由 daemon 校验（同对象每日一次）：already_rated_today 时提示"今日已评过"。
// 本地 ratedToday 镜像做即时禁用，daemon 返回为准。点踩可选填一句说明。
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import { useAgentsStore } from '../store'

const props = defineProps<{
  subjectType: 'agent' | 'team' | 'skill'
  name: string
}>()

const store = useAgentsStore()

const ratedToday = computed(() => store.ratedToday.has(`${props.subjectType}:${props.name}`))
const submitting = ref(false)

async function submit(value: 'up' | 'down'): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  try {
    let text: string | undefined
    if (value === 'down') {
      // 点踩收集可选说明（取消仍裸踩）。
      try {
        const { value: reason } = await ElMessageBox.prompt(
          '哪里不满意？可选填一句说明（格式 / 准确性 / 过度 / 不足…）',
          `反馈「${props.name}」`,
          { confirmButtonText: '提交', cancelButtonText: '跳过', inputPlaceholder: '选填' },
        )
        text = reason?.trim() || undefined
      } catch {
        // 用户取消输入框：仍然提交裸点踩
      }
    }
    const res = await store.rateSubject(props.subjectType, props.name, value, text)
    if (res.ok) {
      ElMessage.success(value === 'up' ? '已收到反馈，谢谢' : '反馈已记录')
    } else if (res.reason === 'already_rated_today') {
      ElMessage.info('今日已评过，明天再来')
    } else {
      ElMessage.warning('反馈未提交')
    }
  } catch (err: unknown) {
    ElMessage.error(err instanceof Error ? err.message : '反馈上报失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <span class="rate-buttons" @click.stop>
    <el-tooltip content="有帮助" placement="top" :hide-after="0">
      <button
        type="button"
        class="rate-btn"
        :disabled="submitting || ratedToday"
        aria-label="有帮助"
        @click="submit('up')"
      >
        <MxIcon name="lucide:thumbs-up" :size="16" />
      </button>
    </el-tooltip>
    <el-tooltip content="没帮助" placement="top" :hide-after="0">
      <button
        type="button"
        class="rate-btn"
        :disabled="submitting || ratedToday"
        aria-label="没帮助"
        @click="submit('down')"
      >
        <MxIcon name="lucide:thumbs-down" :size="16" />
      </button>
    </el-tooltip>
  </span>
</template>

<style scoped>
.rate-buttons {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-1);
}

.rate-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  color: var(--mx-text-tertiary);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.rate-btn:hover:not(:disabled) {
  background: var(--mx-hover);
  color: var(--mx-accent);
}

.rate-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
