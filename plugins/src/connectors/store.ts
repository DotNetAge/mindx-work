/**
 * connectors 插件内部状态（Model）：MCP 连接器清单 + 开关 + 表单与确认状态。
 * 数据读写全部经 daemon.connection 服务（daemon 为唯一连接源）；
 * 壳编排（Overlay 开合、banner 推送）归组件，本 store 只持数据与 RPC 调用。
 * 动作失败一律抛错由调用方呈现（banner），不做静默降级。
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useService } from '@mindx-work/ui-shell-vue'
import type { MCPServerConfig, MCPServerListEntry, MCPServerType } from './types'

// 服务以纯字符串名消费（插件间禁止 import；契约 §10.2）
const DAEMON_CONNECTION = 'daemon.connection'

/** daemon 连接服务结构契约（消费侧仅声明所需形状） */
interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

/** 连接器表单状态（args 以空格分隔字符串编辑，提交时切分；env/headers/credential 为键值对编辑器） */
export interface ConnectorFormState {
  name: string
  type: MCPServerType
  command: string
  args: string
  url: string
  env: Record<string, string>
  headers: Record<string, string>
  credential: Record<string, string>
}

function defaultForm(): ConnectorFormState {
  return {
    name: '',
    type: 'stdio',
    command: '',
    args: '',
    url: '',
    env: {},
    headers: {},
    credential: {},
  }
}

export const useConnectorsStore = defineStore('connectors-store', () => {
  // 服务本体在 store 初始化时捕获（首次 useConnectorsStore 由组件 setup 触发，inject 有效）
  const daemon = useService<DaemonConnection>(DAEMON_CONNECTION)

  // ---------- 清单状态 ----------
  const servers = ref<MCPServerListEntry[]>([])
  const loaded = ref(false)

  async function refresh(): Promise<void> {
    servers.value = await daemon.call<MCPServerListEntry[]>('mcp.server.list', {})
    loaded.value = true
  }

  // ---------- 开关切换（热生效） ----------
  /** 正在切换开关的连接器名（开关 loading，防连点） */
  const switching = ref('')

  /**
   * 切换 enabled：请求期间开关保持原值，成功后更新本地状态。
   * 开启成功后自动测试连接：配置错误在此刻即暴露（失败仅返回警告文案，不回滚开关）。
   */
  async function toggle(server: MCPServerListEntry, enabled: boolean): Promise<string | null> {
    if (switching.value) return null
    switching.value = server.name
    try {
      await daemon.call<{ ok: boolean }>('mcp.server.set_enabled', { name: server.name, enabled })
      server.enabled = enabled
      if (enabled) {
        try {
          const r = await daemon.call<{ ok: boolean; error?: string }>('mcp.server.test', { name: server.name })
          if (!r.ok) return `连接测试未通过：${r.error || '未知错误'}`
        } catch {
          // 测连 RPC 本身失败不打断启用流程（开关切换已成功）
        }
      }
      return null
    } finally {
      switching.value = ''
    }
  }

  // ---------- 表单（新增 / 编辑双模式共用一条目） ----------
  const form = ref<ConnectorFormState>(defaultForm())
  /** 编辑目标连接器名；null = 新增。编辑时 name 锁定（防改名致凭据引用悬空） */
  const editingName = ref<string | null>(null)
  /** 编辑目标是否已配置凭据（凭据值不回显，仅提示留空保持不变） */
  const editingHasCredential = ref(false)

  function openAdd(): void {
    editingName.value = null
    editingHasCredential.value = false
    form.value = defaultForm()
  }

  /** 打开编辑：从列表条目回填（args 数组拼接为空格分隔；凭据只回显"已配置"状态） */
  function openEdit(server: MCPServerListEntry): void {
    editingName.value = server.name
    editingHasCredential.value = Boolean(server.credential_ref)
    form.value = {
      name: server.name,
      type: (server.type as MCPServerType) || 'stdio',
      command: server.command || '',
      args: (server.args || []).join(' '),
      url: server.url || '',
      env: { ...server.env },
      headers: { ...server.headers },
      credential: {},
    }
  }

  /** 保存表单：组装 RPC 参数（空 object 不传；idle_ttl_secs 恒 300，同源定稿） */
  async function save(): Promise<void> {
    const f = form.value
    if (!f.name.trim()) throw new Error('请填写连接器标识')
    const cfg: MCPServerConfig = {
      name: f.name.trim(),
      type: f.type,
      idle_ttl_secs: 300,
    }
    if (f.type === 'stdio') {
      cfg.command = f.command
      cfg.args = f.args ? f.args.split(/\s+/).filter(Boolean) : []
    } else {
      cfg.url = f.url
    }
    if (Object.keys(f.env).length) cfg.env = f.env
    if (Object.keys(f.headers).length) cfg.headers = f.headers
    if (Object.keys(f.credential).length) cfg.credential = f.credential
    if (editingName.value) {
      await daemon.call<{ ok: boolean }>('mcp.server.update', cfg)
    } else {
      await daemon.call<{ ok: boolean }>('mcp.server.add', cfg)
    }
    await refresh()
  }

  // ---------- 删除确认（modal 组件消费） ----------
  const pendingConfirm = ref<{ title: string; message: string; successText: string } | null>(null)
  let confirmAction: (() => Promise<void>) | null = null

  function requestConfirm(
    title: string,
    message: string,
    successText: string,
    action: () => Promise<void>,
  ): void {
    pendingConfirm.value = { title, message, successText }
    confirmAction = action
  }

  function requestRemove(server: MCPServerListEntry): void {
    const display = server.title?.trim() || server.name
    requestConfirm(
      '删除连接器',
      `确定删除连接器「${display}」？该操作不可恢复。`,
      `连接器「${display}」已删除`,
      async () => {
        await daemon.call<{ ok: boolean }>('mcp.server.remove', { name: server.name })
        await refresh()
      },
    )
  }

  /** 确认执行：清空状态后执行动作，返回成功文案供调用方推送通知 */
  async function runConfirm(): Promise<string | undefined> {
    const action = confirmAction
    const successText = pendingConfirm.value?.successText
    confirmAction = null
    pendingConfirm.value = null
    await action?.()
    return successText
  }

  function cancelConfirm(): void {
    confirmAction = null
    pendingConfirm.value = null
  }

  return {
    // 清单
    servers,
    loaded,
    refresh,
    // 开关
    switching,
    toggle,
    // 表单
    form,
    editingName,
    editingHasCredential,
    openAdd,
    openEdit,
    save,
    // 删除确认
    requestRemove,
    pendingConfirm,
    runConfirm,
    cancelConfirm,
  }
})
