/**
 * 主题控制器（军规 1/2/3）：亮 / 暗 / 自动三档，默认"自动"。
 * 机制归壳所有：三档解析为最终外观写入根节点 data-mx-theme，组件永不感知主题名。
 */

export type ThemeMode = 'light' | 'dark' | 'auto'

export interface ThemeController {
  /** 当前档位（非解析结果） */
  readonly mode: ThemeMode
  setMode(mode: ThemeMode): void
  /** 档位变化订阅（供设置界面同步选中态） */
  subscribe(listener: (mode: ThemeMode) => void): () => void
}

const THEME_ATTR = 'data-mx-theme'

/** 桌面桥（preload 注入，纯 Web 环境不存在）：发布主题偏好给原生材质层 */
interface DesktopBridge {
  setNativeThemeSource(mode: 'light' | 'dark' | 'system'): Promise<boolean>
}

declare global {
  interface Window {
    mxDesktop?: DesktopBridge
  }
}

export function createThemeController(): ThemeController {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  let mode: ThemeMode = 'auto'
  const listeners = new Set<(mode: ThemeMode) => void>()

  const apply = () => {
    // "自动"档监听系统外观实时切换
    const resolved = mode === 'auto' ? (media.matches ? 'dark' : 'light') : mode
    document.documentElement.setAttribute(THEME_ATTR, resolved)
    // 发布偏好给 Electron 原生层（nativeTheme.themeSource）：vibrancy 材质必须
    // 跟随应用主题而非系统外观——系统暗 + 应用亮时，材质若仍随系统，
    // 半透明侧栏染色会被深色材质压成暗底（对齐 DSH native-theme-set 机制）
    void window.mxDesktop?.setNativeThemeSource(mode === 'auto' ? 'system' : mode)
  }

  media.addEventListener('change', () => {
    if (mode === 'auto') apply()
  })
  apply()

  return {
    get mode() {
      return mode
    },
    setMode(next) {
      mode = next
      apply()
      for (const listener of [...listeners]) listener(mode)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
