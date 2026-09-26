/**
 * skills 插件内部状态（Model）：全局技能清单 + 导出/编辑/删除 + 在线市场货架与安装。
 * 数据读写全部经 daemon.connection 服务（daemon 为唯一连接源）；
 * 壳编排（Overlay 开合、banner 推送、FLIP 详情）归组件，本 store 只持数据与 RPC 调用。
 * skills_changed 热重载广播到达即静默重拉清单（后台保新，失败不打扰）。
 * 动作失败一律抛错由调用方呈现（banner），同名冲突以 SkillExistsError 供调用方走覆盖确认。
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useService } from '@mindx-work/ui-shell-vue'
import type { MxDesktopBridge } from '@mindx-work/ui-shell'
import type { BundleInstallResult, MarketListResult, MarketPackageInfo, SkillInfo } from './types'
import { FIXED_DOMAINS } from './types'

// 服务以纯字符串名消费（插件间禁止 import；契约 §10.2）
const DAEMON_CONNECTION = 'daemon.connection'

/** daemon 连接服务结构契约（消费侧仅声明所需形状） */
interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
  onNotification(method: string, cb: (params: unknown) => void): () => void
}

/** 同名技能冲突（后端默认拒绝已存在目标；调用方捕获后走覆盖确认重试） */
export class SkillExistsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillExistsError'
  }
}

/** 技能展示名：中文名（metadata.name_zh）优先，回退原名 */
export function skillDisplayName(s: SkillInfo): string {
  const zh = s.metadata?.name_zh
  return (typeof zh === 'string' && zh.trim()) || s.name
}

/** 技能描述本地化：中文环境优先 metadata.description_zh，回退原始 description */
export function skillLocaleDesc(s: SkillInfo): string {
  const zh = s.metadata?.description_zh
  return (typeof zh === 'string' && zh.trim()) || s.description || ''
}

/** 是否第三方技能（有作者或许可证声明） */
export function isThirdParty(s: SkillInfo): boolean {
  return !!(s.metadata?.author || s.license)
}

export const useSkillsStore = defineStore('skills-store', () => {
  // 服务本体在 store 初始化时捕获（首次 useSkillsStore 由组件 setup 触发，inject 有效）
  const daemon = useService<DaemonConnection>(DAEMON_CONNECTION)

  // ---------- 全局技能清单 ----------
  const skills = ref<SkillInfo[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  async function refresh(): Promise<void> {
    skills.value = await daemon.call<SkillInfo[]>('skill.list', {})
    loaded.value = true
  }

  /** 带加载态拉取清单（首开与删除/安装后刷新） */
  async function loadSkills(): Promise<void> {
    loading.value = true
    try {
      await refresh()
    } finally {
      loading.value = false
    }
  }

  /**
   * 本地视图刷新：先通知 daemon 重扫全局库（手动放置的技能无需重启即可见），再拉清单。
   * 部分技能装载失败时 daemon 仍会更新注册表（装载成功者已生效）——告警以返回值呈现，不中断拉取。
   */
  async function reloadLocal(): Promise<string | null> {
    loading.value = true
    try {
      let warning: string | null = null
      try {
        await daemon.call<{ reloaded: number }>('skill.reload', {})
      } catch (err) {
        warning = err instanceof Error ? err.message : String(err)
      }
      await refresh()
      return warning
    } finally {
      loading.value = false
    }
  }

  // skills_changed 热重载广播：到达即静默重拉（已加载过才拉，避免后台空转）
  daemon.onNotification('skills_changed', () => {
    if (!loaded.value) return
    void refresh().catch(() => {
      // 后台保新失败不打扰（下次手动刷新或再次广播自愈）
    })
  })

  // ---------- 删除 ----------
  function requestRemove(skill: SkillInfo): void {
    const display = skillDisplayName(skill)
    requestConfirm(
      '删除技能',
      `确定删除技能「${display}」吗？该操作会移除其 SKILL.md 与全部资源文件。`,
      '删除',
      `技能「${display}」已删除`,
      async () => {
        await daemon.call<{ ok: boolean }>('skill.delete', { name: skill.name })
        await refresh()
      },
    )
  }

  // ---------- 导出（.mindpkg） ----------
  /**
   * 导出全局技能为分发包：系统保存对话框 → skill.export。
   * 返回成功提示文案；用户取消返回空串（静默）；无宿主桥抛错。
   */
  async function exportSkill(skill: SkillInfo): Promise<string> {
    const bridge = (window as unknown as { mxDesktop?: MxDesktopBridge }).mxDesktop
    if (!bridge) throw new Error('当前环境不支持文件保存对话框（需在桌面应用内使用）')
    const outPath = await bridge.dialog.saveFile(`${skill.name}.mindpkg`)
    if (!outPath) return ''
    await daemon.call<{ status: string; name: string; out_path: string }>('skill.export', {
      name: skill.name,
      out_path: outPath,
    })
    return `已导出「${skillDisplayName(skill)}」到 ${outPath}`
  }

  // ---------- 修改 SKILL.md ----------
  const editingSkill = ref<SkillInfo | null>(null)
  const editContent = ref('')

  /** 打开编辑：root_dir 缺失返回 false（调用方提示"无文件系统路径"） */
  function openEdit(skill: SkillInfo): boolean {
    if (!skill.root_dir) return false
    editingSkill.value = skill
    editContent.value = ''
    return true
  }

  /** 读取 SKILL.md 正文（编辑 modal 挂载后调用） */
  async function loadEditContent(): Promise<void> {
    const skill = editingSkill.value
    if (!skill?.root_dir) return
    editContent.value = (await daemon.call<{ content: string }>('fs.read', { path: skill.root_dir + '/SKILL.md' })).content
  }

  /** 保存 SKILL.md 写回并刷新清单 */
  async function saveEdit(): Promise<void> {
    const skill = editingSkill.value
    if (!skill?.root_dir) return
    // fs.write 返回 { status: 'ok' }（daemon 实证）；失败经 RPC error 抛出
    await daemon.call<{ status: string }>('fs.write', {
      path: skill.root_dir + '/SKILL.md',
      content: editContent.value,
    })
    await refresh()
  }

  // ---------- 许可证阅读 ----------
  const license = ref<{ title: string; content: string } | null>(null)

  function openLicense(title: string, content: string): void {
    license.value = { title, content }
  }

  // ---------- 在线市场 ----------
  const marketPackages = ref<MarketPackageInfo[]>([])
  const marketWarning = ref('')
  const marketLoaded = ref(false)
  const marketLoading = ref(false)
  /** 正在安装的市场包名称（按钮 loading） */
  const installing = ref('')

  /** 拉取市场清单（仅展示 skill 类型包；在线优先，失败降级本地缓存并附 warning） */
  async function loadMarket(): Promise<void> {
    marketLoading.value = true
    try {
      const res = await daemon.call<MarketListResult>('market.list', {})
      marketPackages.value = (res.packages || []).filter((p) => p.kind === 'skill')
      marketWarning.value = res.warning || ''
      marketLoaded.value = true
    } finally {
      marketLoading.value = false
    }
  }

  /** 已安装的全局技能名集合：市场包与全局库同名即视为已安装 */
  const installedNames = computed<Set<string>>(() => new Set(skills.value.map((s) => s.name)))

  /** 市场卡片展示名：包内中文名 → 本地库中文名（已安装）→ 包名 */
  function marketDisplayName(pkg: MarketPackageInfo): string {
    const zh = pkg.skillNames?.[pkg.name]
    if (zh) return zh
    const local = skills.value.find((s) => s.name === pkg.name)
    return (local && skillDisplayName(local)) || pkg.name
  }

  /** 市场货架分类标签：清单 category 去重，固定分类在前、其余字典序在后 */
  const marketDomains = computed<string[]>(() => {
    const present = new Set<string>()
    for (const p of marketPackages.value) {
      const c = (p.category || '').trim()
      if (c) present.add(c)
    }
    const ordered = FIXED_DOMAINS.filter((d) => present.has(d))
    const rest = [...present].filter((d) => !FIXED_DOMAINS.includes(d)).sort()
    return [...ordered, ...rest]
  })

  /**
   * 安装市场技能包（下载 → sha256 校验 → 进全局库）。
   * 后端对同名技能默认拒绝——错误消息含"已存在同名技能"时抛 SkillExistsError 供覆盖确认。
   */
  async function installMarket(pkg: MarketPackageInfo, overwrite = false): Promise<string> {
    try {
      await daemon.call<BundleInstallResult>('market.install', {
        kind: 'skill',
        name: pkg.name,
        ...(overwrite ? { overwrite: true } : {}),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('已存在同名技能')) throw new SkillExistsError(msg)
      throw err
    }
    await refresh()
    return `已安装「${marketDisplayName(pkg)}」`
  }

  /** 排队覆盖安装确认（已安装或冲突裁决后调用；modal 打开归组件） */
  function requestOverwrite(pkg: MarketPackageInfo): void {
    requestConfirm(
      '同名技能冲突',
      `全局库已存在同名技能「${pkg.name}」，是否覆盖？覆盖后原技能内容将被替换，不可恢复。`,
      '覆盖',
      `已覆盖安装「${marketDisplayName(pkg)}」`,
      () => installMarket(pkg, true),
    )
  }

  /** 安装 loading 包裹：installing 记录包名供按钮 loading；结果与异常原样上抛（编排归组件） */
  async function withInstalling<T>(pkg: MarketPackageInfo, action: () => Promise<T>): Promise<T> {
    installing.value = pkg.name
    try {
      return await action()
    } finally {
      installing.value = ''
    }
  }

  // ---------- 本地导入分发包 ----------
  /** 弹出系统选择对话框取分发包路径；取消返回 null（无宿主桥抛错） */
  async function pickImportPath(): Promise<string | null> {
    const bridge = (window as unknown as { mxDesktop?: MxDesktopBridge }).mxDesktop
    if (!bridge) throw new Error('当前环境不支持文件选择对话框（需在桌面应用内使用）')
    return bridge.dialog.openMindpkg()
  }

  /**
   * 本地导入技能分发包（进全局库）→ skill.import。
   * 返回成功提示文案；同名冲突抛 SkillExistsError（消息含"已存在同名技能"，供覆盖确认提取名字）。
   */
  async function importPackage(path: string, overwrite = false): Promise<string> {
    let result: BundleInstallResult
    try {
      result = await daemon.call<BundleInstallResult>('skill.import', {
        path,
        ...(overwrite ? { overwrite: true } : {}),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('已存在同名技能')) throw new SkillExistsError(msg)
      throw err
    }
    await refresh()
    return `已安装「${result.name}」`
  }

  // ---------- 详情正文读取 ----------
  /**
   * 读取技能正文：本地读技能目录；市场优先读已安装副本、未安装走预览 RPC（下载读取不安装）。
   * 返回原始 markdown（frontmatter 剥离与渲染归视图层）。
   */
  async function readSkillDoc(kind: 'local' | 'market', name: string, rootDir?: string): Promise<string> {
    if (kind === 'local') {
      if (!rootDir) throw new Error('该技能无文件系统路径，无法预览内容')
      // fs.read 返回 { content }（daemon 实证），非纯字符串
      return (await daemon.call<{ content: string }>('fs.read', { path: rootDir + '/SKILL.md' })).content
    }
    const local = skills.value.find((s) => s.name === name)
    if (local?.root_dir) {
      return (await daemon.call<{ content: string }>('fs.read', { path: local.root_dir + '/SKILL.md' })).content
    }
    const r = await daemon.call<{ content: string }>('market.package.read', { name })
    return r.content
  }

  // ---------- 确认范式（modal 组件消费；删除/覆盖安装/覆盖导入共用） ----------
  const pendingConfirm = ref<{ title: string; message: string; confirmText: string; successText: string } | null>(null)
  let confirmAction: (() => Promise<unknown>) | null = null

  function requestConfirm(
    title: string,
    message: string,
    confirmText: string,
    successText: string,
    action: () => Promise<unknown>,
  ): void {
    pendingConfirm.value = { title, message, confirmText, successText }
    confirmAction = action
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
    // 全局技能
    skills,
    loading,
    loaded,
    loadSkills,
    reloadLocal,
    // 删除
    requestRemove,
    // 导出
    exportSkill,
    // 编辑
    editingSkill,
    editContent,
    openEdit,
    loadEditContent,
    saveEdit,
    // 许可证
    license,
    openLicense,
    // 市场
    marketPackages,
    marketWarning,
    marketLoaded,
    marketLoading,
    installing,
    loadMarket,
    installedNames,
    marketDisplayName,
    marketDomains,
    installMarket,
    requestOverwrite,
    withInstalling,
    // 导入
    pickImportPath,
    importPackage,
    // 详情
    readSkillDoc,
    // 确认（requestConfirm 供组件排队自定义文案确认；执行/取消归 modal 组件）
    pendingConfirm,
    requestConfirm,
    runConfirm,
    cancelConfirm,
  }
})
