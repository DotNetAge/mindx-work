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

/** 宿主桥总面：主题偏好发布 + 在线插件安装管理 */
export interface MxDesktopBridge {
  setNativeThemeSource(mode: string): Promise<boolean>
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
  }
}

declare global {
  interface Window {
    mxDesktop?: MxDesktopBridge
  }
}
