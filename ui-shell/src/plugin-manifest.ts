/**
 * 在线插件包清单（manifest.json）定稿：类型 + 校验。
 * 版本语义：id 是身份，version 是不可变代际（semver），激活指针在安装清单；
 * 项目插件（core）与在线插件（market）运行形态完全一致，唯一差异是可删除性。
 */

/** 壳契约版本：动态插件可用的 mx API 面（八区注册 / services / SDK 注入参数）定稿序号。
 * 契约破坏性变更时递增；manifest.mxApiVersion 不等于当前值即拒绝加载（未知版本明确拒绝，不猜测兼容） */
export const MX_API_VERSION = '1'

/** 在线插件包清单（包内 manifest.json）。
 * 社区化元数据（author/url/repo/license/description）是产品化分发重点：
 * 安装确认与市场卡片据此呈现署名、许可与源码可信度 */
export interface PluginManifest {
  /** 插件身份：反向域小写 id（至少两段，如 "com.example.viewer"），安装后不变 */
  id: string
  /** 展示名 */
  name: string
  /** 不可变代际版本号（严格 semver 三段，如 1.0.0） */
  version: string
  /** 一句话说明（市场卡片与安装确认的正文） */
  description: string
  /** 作者（署名必填：社区分发的信任基础） */
  author: string
  /** 插件主页（可选，完整 URL） */
  url?: string
  /** 源码库地址（可选，完整 URL；开源插件的市场卡片展示） */
  repo?: string
  /** 许可证（必填 SPDX 表达式，如 MIT / Apache-2.0） */
  license: string
  /** 包内入口文件名（ESM，export default (app, mx) => cleanup），如 "entry.mjs" */
  entry: string
  /** 权限声明清单（v1 为告知性：安装确认对话框向用户展示） */
  permissions: string[]
  /** 壳契约版本（须等于 MX_API_VERSION） */
  mxApiVersion: string
}

/** semver 三段（不含通配/范围——插件包版本是精确代际） */
const SEMVER_RE = /^\d+\.\d+\.\d+$/

/** 反向域 id：至少两段小写段，段内小写字母数字与连字符 */
const PLUGIN_ID_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/

/** URL 格式（http/https） */
const URL_RE = /^https?:\/\/\S+$/

/** 逐字段校验 manifest；返回错误清单（空 = 通过）。一次收集全部问题，安装期显式暴露 */
export function manifestIssues(value: unknown): string[] {
  const issues: string[] = []
  if (typeof value !== 'object' || value === null) return ['清单不是对象']
  const m = value as Record<string, unknown>
  if (typeof m.id !== 'string' || !PLUGIN_ID_RE.test(m.id)) {
    issues.push('id 必须是至少两段的反向域小写 id（如 com.example.viewer）')
  }
  if (typeof m.name !== 'string' || m.name.trim() === '') issues.push('name 不能为空')
  if (typeof m.version !== 'string' || !SEMVER_RE.test(m.version)) {
    issues.push('version 必须是严格三段 semver（如 1.0.0）')
  }
  if (typeof m.description !== 'string' || m.description.trim() === '') {
    issues.push('description 不能为空（社区分发必填）')
  }
  if (typeof m.author !== 'string' || m.author.trim() === '') {
    issues.push('author 不能为空（署名必填）')
  }
  if (m.url !== undefined && (typeof m.url !== 'string' || !URL_RE.test(m.url))) {
    issues.push('url 必须是完整的 http(s) 地址')
  }
  if (m.repo !== undefined && (typeof m.repo !== 'string' || !URL_RE.test(m.repo))) {
    issues.push('repo 必须是完整的 http(s) 地址')
  }
  if (typeof m.license !== 'string' || m.license.trim() === '') {
    issues.push('license 不能为空（许可证必填，如 MIT）')
  }
  if (typeof m.entry !== 'string' || !m.entry.endsWith('.mjs')) {
    issues.push('entry 必须是 .mjs 入口文件名')
  }
  if (!Array.isArray(m.permissions) || m.permissions.some((p) => typeof p !== 'string')) {
    issues.push('permissions 必须是字符串数组')
  }
  if (m.mxApiVersion !== MX_API_VERSION) {
    issues.push(`mxApiVersion ${String(m.mxApiVersion)} 与壳契约版本 ${MX_API_VERSION} 不匹配`)
  }
  return issues
}
