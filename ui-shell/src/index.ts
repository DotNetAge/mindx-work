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
export { createFileTypesContext, type FileTypesContext } from './fileTypes'
export { createApp, validateShellConstraints, type AppShell } from './createApp'
export { MX_API_VERSION, manifestIssues, type PluginManifest } from './plugin-manifest'
export {
  MARKET_RUNTIME_SERVICE,
  PLUGIN_CATALOG_SERVICE,
  type CorePluginInfo,
  type InstalledPluginView,
  type MarketPluginView,
  type MarketRuntime,
  type MarketVersionView,
  type MxDesktopBridge,
  type PluginExportResult,
  type PluginInstallResult,
  type PreferencesController,
  PREFERENCES_SERVICE,
  type InstallerStatus,
  type UpdaterCheckResult,
  type UpdaterSnapshot,
} from './desktop-bridge'
export {
  GENERAL_PAGE_ID,
  type ContentEntry,
  type ContentViewApi,
  type DetailEntry,
  type DetailViewApi,
  type FloaterAnimation,
  type FloaterEntry,
  type FloaterViewApi,
  type OverlayEntry,
  type OverlayViewApi,
  type PrefPageEntry,
  type PrefRowEntry,
  type PreferencesApi,
  type SheetEntry,
  type SheetViewApi,
  type SidebarEntry,
  type SidebarViewApi,
  type ToolbarEntry,
  type ToolbarViewApi,
} from './views'
