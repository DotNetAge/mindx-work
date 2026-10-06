<script setup lang="ts">
/**
 * 市场评分共享授权行（设置页「数据与隐私」唯一行，白皮书《决策量表》8.4 出网边界）：
 * 同意书三要点（授权范围 / 匿名化声明 / 撤回方式）+ 授权开关。
 * 状态读写走 metric.consent.get/set（daemon 存 kv.db，默认拒绝）；
 * 授权是市场评分上传的前置条件，未授权时上传路径不得发起任何网络请求。
 */
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useService } from '@mindx-work/ui-shell-vue'
import type { DaemonConnection } from '../../connection/runtime'

const conn = useService<DaemonConnection>('daemon.connection')

const granted = ref(false)
const loading = ref(false)
const submitting = ref(false)

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const res = await conn.call<{ granted?: boolean } | null>('metric.consent.get')
    granted.value = !!res?.granted
  } catch {
    // 读取失败保持未授权默认态（保守：无法确认授权即按未授权呈现）
  } finally {
    loading.value = false
  }
}

async function toggle(value: boolean): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  const prev = granted.value
  granted.value = value // 乐观更新，失败回滚
  try {
    await conn.call('metric.consent.set', { granted: value })
    ElMessage.success(value ? '已授权聚合评分共享' : '已撤回授权，上传已停止')
  } catch (err) {
    granted.value = prev
    ElMessage.error(err instanceof Error ? err.message : '授权状态保存失败')
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <div :class="$style.wrap">
    <div class="mx-pref-row">
      <div class="mx-pref-label">
        <span class="mx-pref-title">市场评分共享</span>
        <span class="mx-pref-desc">
          开启后，您对智能体与技能的评价将以聚合计数与占比的形式（如「本周获赞 12 次、好评率 83%」）上传到市场用于展示。
          评价文本、会话内容与轮次明细一律保存在本机，无论是否授权都不出本机。
          随时关闭开关即撤回授权，撤回后立即停止上传。
        </span>
      </div>
      <el-switch
        :model-value="granted"
        :loading="submitting || loading"
        aria-label="市场评分共享授权"
        @change="(v: string | number | boolean) => toggle(!!v)"
      />
    </div>
    <div :class="$style.state">
      {{ granted ? '已授权：聚合评分将随评价产生上传' : '未授权：不上传任何数据' }}
    </div>
  </div>
</template>

<style module>
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
}

.state {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}
</style>
