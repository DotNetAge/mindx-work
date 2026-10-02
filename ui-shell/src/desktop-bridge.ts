/**
 * 宿主环境桥（preload contextBridge 注入 window.mxDesktop）的类型定稿。
 * 家在 ui-shell（内核契约层）：app 与 ui-shell-vue 的 tsconfig 均 include 本包源，
 * 全局 Window 声明对所有渲染侧包可见（IDE 与编译同一视角）。
 * 纯 Web 环境（浏览器直开）无此桥，全部能力可选（window.mxDesktop === undefined）。
 */

/** 已安装插件视图（主进程 IPC 回执）：含目录身份与版本指针 */
export interface InstalledPluginView {
  id: string
  name: string
  version: string
  enabled: boolean
  /** 该插件全部已装版本 */
  versions: string[]
  /** 入口绝对路径（信息面；渲染加载统一走 mx-plugin:// 协议） */
  entryPath: string
  origin: 'market'
}

/** 本地包安装回执 */
export interface PluginInstallResult {
  ok: boolean
  message?: string
}

/** 市场条目的一个可装版本（静态托管 index.json 格式定稿） */
export interface MarketVersionView {
  version: string
  /** zip 包完整 URL */
  url: string
  /** 包 sha256（安装时完整性校验） */
  sha256: string
}

/** 市场条目（index.json plugins 数组成员；社区化元数据是安装确认的呈现依据） */
export interface MarketPluginView {
  id: string
  name: string
  description: string
  author: string
  url?: string
  repo?: string
  license: string
  permissions: string[]
  versions: MarketVersionView[]
}

/** 在线插件运行期控制（宿主装配层提供，market 插件经 services 消费；
 * 类型定稿在 ui-shell——app 实现与插件消费都正向依赖本包，避免插件反向依赖 app） */
export interface MarketRuntime {
  /** 激活一个已安装插件（重复激活幂等）；失败抛错，状态不翻转由调用方保证 */
  activate(view: InstalledPluginView): Promise<void>
  /** 停用并执行插件清理函数（未激活时幂等空操作） */
  deactivate(id: string): void
}

/** 在线插件运行期控制的 services 注册名（提供方 app 装配层，消费方 market 插件） */
export const MARKET_RUNTIME_SERVICE = 'shell.market-runtime'

/** 预置（内置）插件展示条目：编译进应用的插件无独立版本号，随应用整体发版 */
export interface CorePluginInfo {
  /** 展示用短 id（仅目录显示用，非注册身份） */
  id: string
  name: string
  description: string
}

/** 预置插件目录的 services 注册名（提供方 app 装配层——唯一知道全量插件清单的地方，
 * 消费方 market 插件的「已安装插件」全量视图） */
export const PLUGIN_CATALOG_SERVICE = 'shell.plugin-catalog'

/** 导出插件回执：ok 时 path 为写入的 zip 绝对路径 */
export interface PluginExportResult {
  ok: boolean
  path?: string
  message?: string
}

/** 设置持久化控制器（提供方 app 装配层，消费方设置行/插件）：
 * 内存缓存 + 经宿主桥落盘 userData/preferences.json（无宿主桥时降级为仅内存）。
 * 键语义归消费方解释（建议前缀 `<owner>.<key>` 防跨插件撞键） */
export interface PreferencesController {
  /** 持久化读回是否已完成（完成前 get 只返回 fallback / set 仅入内存） */
  readonly ready: Promise<void>
  /** 读偏好：未读回或无此键时返回 fallback */
  get<T>(key: string, fallback: T): T
  /** 写偏好：立即通知订阅者并异步落盘（写盘失败不回滚内存，仅告警） */
  set(key: string, value: unknown): void
  /** 订阅某键变化（set 触发；返回退订函数） */
  subscribe(key: string, listener: (value: unknown) => void): () => void
}

/** 设置持久化控制器的 services 注册名（提供方 app 装配层） */
export const PREFERENCES_SERVICE = 'shell.preferences'

/** 更新状态快照（主进程 updater.ts 同名类型同构）：驱动渲染层纯图标的出现与进度态 */
export interface UpdaterSnapshot {
  /** 自动更新能力是否启用（dev / ad-hoc 未公证构建 = false） */
  enabled: boolean
  /** 当前应用版本 */
  currentVersion: string
  /** 事件机状态：idle 无事 / checking 检查中 / downloading 下载中 / ready 待安装 */
  status: 'idle' | 'checking' | 'downloading' | 'ready'
  /** 发现的更新版本 */
  availableVersion: string | null
  /** 下载进度 0-100（downloading 态） */
  percent: number | null
}

/** 智能主机安装状态（与主进程 daemon-installer.ts InstallerStatus 同构） */
export interface InstallerStatus {
  state:
    | 'boot'
    | 'detecting'
    | 'downloading'
    | 'extracting'
    | 'registering'
    | 'starting'
    | 'ready'
    | 'error'
    | /** 当前平台无内置分发（Windows 第四期） */ 'unsupported'
  /** 下载进度 0-100；非下载阶段为 null */
  progress?: number | null
  /** 人类可读的阶段/错误信息 */
  message?: string
  /** 原始错误详情（stderr/命令输出），供复制诊断 */
  errorDetail?: string
  /** 全局二进制安装位置 */
  installDir?: string
}

/** 手动检查更新回执：ok=false 时 reason 为中文原因文案 */
export interface UpdaterCheckResult {
  ok: boolean
  reason?: string
}

/** 宿主桥总面：主题偏好发布 + 设置持久化 + 系统文件对话框 + 在线插件安装管理 + 导航兜底回发 + 应用自动更新 */
export interface MxDesktopBridge {
  setNativeThemeSource(mode: string): Promise<boolean>
  /** 订阅主进程导航拦截回发的外部 web 链接（mx:open-url）；返回退订函数 */
  onOpenUrl(listener: (url: string) => void): () => void
  /** 系统浏览器打开链接（mx:open-external，主进程侧仅放行 http/https）；拒绝返回 false */
  openExternal(url: string): Promise<boolean>
  /** 系统默认程序打开本地文件（mx:open-path）；成功返回空串，失败返回错误描述 */
  openPath(path: string): Promise<string>
  preferences: {
    /** 读整表（机械校验与代际分流在主进程侧执行） */
    getAll(): Promise<Record<string, unknown> | null>
    /** 合并写单键（原子写由主进程保证） */
    set(key: string, value: unknown): Promise<boolean>
  }
  dialog: {
    /** 系统保存文件对话框（defaultName 为缺省文件名）；取消返回 null */
    saveFile(defaultName: string): Promise<string | null>
    /** 选择技能分发包（.mindpkg）；取消返回 null */
    openMindpkg(): Promise<string | null>
  }
  terminal: {
    /** 创建 pty 会话（cwd 空串回退主进程 homedir）；返回会话 id，失败返回 null */
    create(cwd: string, cols: number, rows: number): Promise<string | null>
    write(id: string, data: string): Promise<boolean>
    resize(id: string, cols: number, rows: number): Promise<boolean>
    kill(id: string): Promise<boolean>
    /** 订阅输出回推；返回退订函数 */
    onData(listener: (payload: { id: string; data: string }) => void): () => void
    onExit(listener: (payload: { id: string }) => void): () => void
  }
  updater: {
    /** 拉取状态快照（构造时先拉一次，后续靠事件推送）；无宿主能力返回 null */
    getState(): Promise<UpdaterSnapshot | null>
    /** 手动检查更新；disabled 构建返回 { ok:false, reason } */
    checkNow(): Promise<UpdaterCheckResult>
    /** 确认安装已下载的更新（quitAndInstall 立即重启安装；仅 ready 态有效） */
    install(): Promise<boolean>
    /** 主进程状态推送订阅；返回退订函数 */
    onEvent(listener: (snapshot: UpdaterSnapshot) => void): () => void
  }
  wizard: {
    /** 打开首启向导窗（设置页重入入口；主进程幂等——已有向导窗则唤出） */
    open(): Promise<boolean>
    /** 向导关闭通知订阅（连接运行时据此重读配置重连）；返回退订函数 */
    onFinished(listener: () => void): () => void
  }
  /** 首启向导探测通道族（仅向导窗存在期间在主进程注册；报告形态见 ProbeReport） */
  probe: {
    /** 全量环境探测（只读；凭据只回键名与来源，不回值） */
    run(): Promise<unknown>
    /** 验证单条凭据（供应商最小请求；不回显 key） */
    verifyCredential(key: string): Promise<{ ok: boolean; reason?: string }>
    /** 取回已验证凭据的值（一次性，仅存渲染层内存用于 daemon RPC 参数） */
    takeCredential(key: string): Promise<string | null>
  }
  /** 智能主机本机安装服务（常驻注册；向导「本机安装」步消费） */
  installer: {
    /** 拉取安装状态快照（进安装步先拉一次，后续靠事件推送）；无宿主能力返回 null */
    getStatus(): Promise<InstallerStatus | null>
    /** 启动安装（幂等：并发调用合并为一次执行） */
    start(): Promise<InstallerStatus | null>
    /** 读取 daemon 错误日志尾部（200 行/256KB 截断） */
    getLog(): Promise<{ path: string; content: string }>
    /** 安装状态推送订阅（各阶段迁移时触发）；返回退订函数 */
    onEvent(listener: (status: InstallerStatus) => void): () => void
  }
  plugins: {
    list(): Promise<InstalledPluginView[] | null>
    installFromFile(): Promise<PluginInstallResult>
    /** 拉取市场索引（结构校验在渲染侧消费处执行） */
    marketList(): Promise<unknown>
    /** 从市场 URL 下载安装（sha256 非空时做完整性比对） */
    installFromUrl(url: string, sha256?: string): Promise<PluginInstallResult>
    uninstall(id: string): Promise<boolean>
    setEnabled(id: string, enabled: boolean): Promise<boolean>
    setActiveVersion(id: string, version: string): Promise<boolean>
    /** 导出已装插件为 zip（主进程弹保存对话框）；取消返回 ok=false */
    export(id: string): Promise<PluginExportResult>
    /** 订阅清单变更（mw CLI 落盘后主进程广播）：回调内拉取 list 重扫激活 */
    onChanged(cb: () => void): void
  }
}

declare global {
  interface Window {
    mxDesktop?: MxDesktopBridge
  }
}
