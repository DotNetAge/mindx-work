/**
 * 设置持久化（userData/preferences.json）：设置项的内置落盘能力。
 * 机制对齐 installed.json（plugins.ts）：原子写（tmp + rename）、schemaVersion 代际纪律——
 * 单调递增、未知版本拒绝读取（不猜测兼容）、损坏文件视为空并告警（不覆盖原文件，
 * 坏文件留给用户/开发者排查）。
 * IPC 边界（契约 §17）：本模块只做机械校验（key 为非空字符串、value 可序列化）；
 * 键的语义（哪些键存在、取值范围）归消费方（壳服务与插件）解释。
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const SCHEMA_VERSION = 1

/** 持久化文件：values 为键值表（JSON 可序列化值），schemaVersion 只增字段 */
interface PreferencesFile {
  schemaVersion: 1
  values: Record<string, unknown>
}

function preferencesFilePath(): string {
  return path.join(app.getPath('userData'), 'preferences.json')
}

function readPreferences(): PreferencesFile {
  const file = preferencesFilePath()
  if (!existsSync(file)) return { schemaVersion: SCHEMA_VERSION, values: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    console.error('设置持久化文件损坏，按空设置启动（原文件保留未覆盖）：', error)
    return { schemaVersion: SCHEMA_VERSION, values: {} }
  }
  const shape = parsed as Partial<PreferencesFile> | null
  if (!shape || typeof shape !== 'object' || shape.schemaVersion !== SCHEMA_VERSION || typeof shape.values !== 'object' || shape.values === null) {
    console.error(`设置持久化文件代际或结构不符（schemaVersion=${String((shape as { schemaVersion?: unknown } | null)?.schemaVersion)}），拒绝读取`)
    return { schemaVersion: SCHEMA_VERSION, values: {} }
  }
  return { schemaVersion: SCHEMA_VERSION, values: shape.values }
}

/** 主进程侧读整表（向导门判定用）：损坏/代际不符按空表（与 IPC 读同语义） */
export function readPreferencesValues(): Record<string, unknown> {
  return readPreferences().values
}

/** 合并单键并原子写盘（writeFileSync tmp + renameSync，断电不留半文件） */
function setPreference(key: string, value: unknown): boolean {
  if (typeof key !== 'string' || key.length === 0) return false
  if (value === undefined) return false
  const data = readPreferences()
  data.values[key] = value
  const file = preferencesFilePath()
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, file)
  return true
}

/** 注册设置持久化 IPC（渲染侧经 preload 桥调用） */
export function registerPreferencesBridge(): void {
  ipcMain.handle('mx:preferences-get', (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return null
    return readPreferences().values
  })
  ipcMain.handle('mx:preferences-set', (event, key: unknown, value: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return false
    return setPreference(key as string, value)
  })
}
