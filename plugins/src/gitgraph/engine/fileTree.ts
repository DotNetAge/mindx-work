/**
 * 文件树与 diff 渲染的纯函数层（零依赖、零 IO）：目录分组（GitLens 同构的
 * 一级目录分组树）与 unified diff 行分类。仅被 GitGraphPanel 消费，数据来自
 * engine/gitSource。
 */

import type { FileEntry } from '../types'

/** 目录分组：目录行（可折叠）+ 组内文件行（GitLens 同构一级分组） */
export interface FileGroup {
  /** 目录路径（仓库相对，posix；空串 = 根目录文件组，无目录行直接平铺） */
  dir: string
  files: FileEntry[]
}

/** posix 目录部分（无目录返回空串；Windows 风格路径在仓库数据中不存在） */
export function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/** 路径末段（文件名） */
export function baseName(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

/**
 * 按目录公共前缀分组：同目录文件归入一组（组序按目录名，组内按原输出序，
 * 保持 git 的 topo 稳定顺序）；根目录文件平铺在顶层。R/C 双路径不同目录时
 * 按新路径分组（旧行信息由渲染层的 rename 关系表达）。
 */
export function buildFileGroups(entries: FileEntry[]): FileGroup[] {
  const byDir = new Map<string, FileEntry[]>()
  for (const entry of entries) {
    const dir = dirOf(entry.path)
    const list = byDir.get(dir)
    if (list) list.push(entry)
    else byDir.set(dir, [entry])
  }
  // 目录名排序（根目录组永远在最前，符合文件树直觉）
  return [...byDir.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map(([dir, files]) => ({ dir, files }))
}

// ── unified diff 行分类 ──────────────────────────────────────────────────────

export interface DiffLine {
  kind: 'add' | 'del' | 'hunk' | 'ctx' | 'meta'
  text: string
}

/** 渲染行数上限（保护 DOM：2MB 文本可达数万行，v-for 全量会卡死列表） */
export const DIFF_RENDER_MAX = 2000

/**
 * unified diff → 行分类：hunk 头 / 增 / 删 / 上下文 / 元信息
 * （diff --git、rename from/to、similarity index 等头段，rename 场景有信息
 * 量保留展示，index/mode 行过滤）。---/+++ 头行过滤（与删除行 `-` 前缀歧义）。
 */
export function parseUnifiedDiff(text: string): DiffLine[] {
  const lines: DiffLine[] = []
  for (const raw of text.split('\n')) {
    // 末尾空行（文本以 \n 结尾的 split 残留）跳过
    if (raw === '' && lines.length > 0 && lines[lines.length - 1]?.text === '') continue
    if (raw.startsWith('@@')) {
      lines.push({ kind: 'hunk', text: raw })
    } else if (raw.startsWith('diff --git') || raw.startsWith('rename ') || raw.startsWith('similarity index') || raw.startsWith('copy ') || raw.startsWith('Binary files')) {
      lines.push({ kind: 'meta', text: raw })
    } else if (raw.startsWith('index ') || raw.startsWith('---') || raw.startsWith('+++') || raw.endsWith('mode 100644') || raw.endsWith('mode 100755') || raw.startsWith('new file') || raw.startsWith('deleted file')) {
      // 头段噪音：index 行、---/+++、mode 变化、new/deleted file 说明行
      continue
    } else if (raw.startsWith('+')) {
      lines.push({ kind: 'add', text: raw })
    } else if (raw.startsWith('-')) {
      lines.push({ kind: 'del', text: raw })
    } else if (raw !== '') {
      lines.push({ kind: 'ctx', text: raw })
    }
  }
  return lines
}

/** 渲染截断：返回可见行与被省略行数（数据未截断但行数超渲染上限时用） */
export function clipDiffLines(lines: DiffLine[]): { visible: DiffLine[]; omitted: number } {
  if (lines.length <= DIFF_RENDER_MAX) return { visible: lines, omitted: 0 }
  return { visible: lines.slice(0, DIFF_RENDER_MAX), omitted: lines.length - DIFF_RENDER_MAX }
}
