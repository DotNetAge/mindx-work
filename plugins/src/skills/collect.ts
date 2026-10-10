/**
 * 凭据收集状态单例：daemon 侧准备流程评估到 envs 对象形态条目缺失时，经
 * skill.credential_collect 通知广播收集请求（对齐 oauth flow.ts 的模块级
 * reactive 单例先例，弹窗与调用方共享）。通知到达即写入待收集清单，index.ts
 * 同步弹收集框；提交走 store.submitCredentials（skill.credential.set 落库 +
 * skill.prepare 重入推进）。凭据值只存在 modal 本地输入态，不进此单例。
 */

import { reactive } from 'vue'
import type { SkillEnvCollectItem } from './types'

export interface CredentialCollectState {
  /** 收集请求在途（弹窗以 active 呈现） */
  active: boolean
  skill: string
  envs: SkillEnvCollectItem[]
}

export const credentialCollect = reactive<CredentialCollectState>({
  active: false,
  skill: '',
  envs: [],
})

/** 通知分发（index.ts 订阅转发）：解析收集请求写入单例 */
export function handleCollectNotification(params: unknown): void {
  const data = (params as { data?: Record<string, unknown> } | null)?.data ?? {}
  const skill = typeof data.skill === 'string' ? data.skill : ''
  const rawEnvs = Array.isArray(data.envs) ? data.envs : []
  const envs: SkillEnvCollectItem[] = []
  for (const raw of rawEnvs) {
    const item = raw as Record<string, unknown>
    if (typeof item.name !== 'string' || !item.name.trim()) continue
    envs.push({
      name: item.name,
      prompt: typeof item.prompt === 'string' ? item.prompt : undefined,
      url: typeof item.url === 'string' ? item.url : undefined,
      sensitive: item.sensitive === true,
    })
  }
  if (!skill || envs.length === 0) return
  credentialCollect.active = true
  credentialCollect.skill = skill
  credentialCollect.envs = envs
}

/** 收集结束（提交成功或用户取消）后的状态清理（active=false 迟到事件被忽略） */
export function endCollect(): void {
  credentialCollect.active = false
  credentialCollect.envs = []
}
