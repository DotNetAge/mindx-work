/** 内核导出：渲染无关，零 Vue 依赖 */

export type {
  Entry,
  Glyph,
  OverlayKind,
  Plugin,
  ServiceContext,
  SidebarRow,
  Unsubscribe,
  ViewProps,
} from './types'
export { createApp, validateShellConstraints, type AppShell } from './createApp'
export { MX_API_VERSION, manifestIssues, type PluginManifest } from './plugin-manifest'
export {
  MARKET_RUNTIME_SERVICE,
  type InstalledPluginView,
  type MarketPluginView,
  type MarketRuntime,
  type MarketVersionView,
  type MxDesktopBridge,
  type PluginInstallResult,
  type PreferencesController,
  PREFERENCES_SERVICE,
} from './desktop-bridge'
export {
  GENERAL_PAGE_ID,
  type ContentEntry,
  type ContentViewApi,
  type DetailEntry,
  type DetailViewApi,
  type OverlayEntry,
  type OverlayViewApi,
  type PrefPageEntry,
  type PrefRowEntry,
  type PreferencesApi,
  type SidebarEntry,
  type SidebarViewApi,
  type ToolbarEntry,
  type ToolbarViewApi,
} from './views'
