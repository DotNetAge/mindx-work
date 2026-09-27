// Tiptap 自定义节点：文件引用 chip（源：mindx-desktop ChatInput/fileRefNode.ts 全量平移）。
// 原子（atom）内联节点——光标整体选中/删除，不会进入内部编辑；对外序列化为纯文本，
// 因此下游发送链路看到的仍是字符串，无需感知富文本结构。
// 支持可选行号范围（startLine/endLine）：来自编辑器「选中代码行添加到对话」入口；
// 序列化格式为 `路径:起始行-结束行`（无行号时即裸路径）。
// 图标（work 适配，同 LangBadge.vue 先例）：纯 TS 复刻 vscode getIconClasses 的类名
// 组合算法（name/ext/folder），实际图形由文件图标主题 CSS（.show-file-icons 作用域）
// 渲染，主题切换自动跟随——work 无 monaco-vscode-api 依赖，不引 monaco 服务。
import { Node, mergeAttributes } from '@tiptap/core'

export interface FileRefAttrs {
  /** 完整绝对路径（序列化与出站消息使用） */
  path: string
  /** 是否目录（explorer「添加到对话」stat 探测，决定文件夹/文件图标） */
  isDir?: boolean | null
  /** 引用起始行（1-based，可选） */
  startLine?: number | null
  /** 引用结束行（可选） */
  endLine?: number | null
}

// 与 vscode fileIconSelectorEscape 一致：CSS 类名安全化（同 LangBadge.vue）
function selectorEscape(s: string): string {
  return s.replace(/[^a-z0-9-]/g, (c) => `\\${c}`)
}

/** 计算路径的主题图标 class（类名算法与 vscode getIconClasses 一致，见 LangBadge.vue） */
function computeIconClasses(path: string, isDir: boolean): string[] {
  const base = path.split(/[\\/]/).filter(Boolean).pop() || path
  const name = selectorEscape(base.toLowerCase())
  if (isDir) {
    return ['file-icon', `${name}-name-folder-icon`, 'name-folder-icon', 'folder-icon']
  }
  const result = ['file-icon', `${name}-name-file-icon`, 'name-file-icon']
  // 逐段扩展名：skill.md → `skill.md-ext-file-icon` + `md-ext-file-icon`
  const dotSegments = name.split('.')
  for (let i = 1; i < dotSegments.length; i++) {
    result.push(`${dotSegments.slice(i).join('.')}-ext-file-icon`)
  }
  result.push('ext-file-icon')
  return result
}

/** 由属性合成对外序列化文本与展示短名（basename[:s-e]） */
export function fileRefTextParts(attrs: {
  path: string
  startLine?: number | null
  endLine?: number | null
}): { full: string; label: string } {
  const seg = attrs.path.split('/').filter(Boolean)
  const base = seg[seg.length - 1] || attrs.path
  const hasRange =
    typeof attrs.startLine === 'number' &&
    typeof attrs.endLine === 'number' &&
    attrs.endLine >= attrs.startLine
  const suffix = hasRange ? `:${attrs.startLine}-${attrs.endLine}` : ''
  return { full: `${attrs.path}${suffix}`, label: `${base}${suffix}` }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fileRef: {
      /** 在当前选区/位置插入一个文件引用 chip */
      insertFileRef: (ref: FileRefAttrs) => ReturnType
    }
  }
}

export const FileRef = Node.create({
  name: 'fileRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      path: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute('data-path'),
        renderHTML: (attrs) => ({ 'data-path': attrs.path })
      },
      isDir: {
        default: null as boolean | null,
        parseHTML: (el) => (el.getAttribute('data-is-dir') === 'true' ? true : null),
        renderHTML: (attrs) => (attrs.isDir === true ? { 'data-is-dir': 'true' } : {})
      },
      startLine: {
        default: null as number | null,
        parseHTML: (el) => {
          const v = Number(el.getAttribute('data-start-line'))
          return Number.isFinite(v) && v > 0 ? v : null
        },
        renderHTML: (attrs) =>
          attrs.startLine != null ? { 'data-start-line': String(attrs.startLine) } : {}
      },
      endLine: {
        default: null as number | null,
        parseHTML: (el) => {
          const v = Number(el.getAttribute('data-end-line'))
          return Number.isFinite(v) && v > 0 ? v : null
        },
        renderHTML: (attrs) =>
          attrs.endLine != null ? { 'data-end-line': String(attrs.endLine) } : {}
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="file-ref"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as FileRefAttrs
    const { label } = fileRefTextParts(attrs)
    // 图标：class 由当前文件图标主题的 CSS 渲染（.show-file-icons 作用域，见 index.vue 样式）
    const iconClasses = computeIconClasses(attrs.path || '', attrs.isDir === true)
    const children: (string | unknown[])[] = []
    if (iconClasses.length > 0) {
      children.push(['i', { class: `file-ref-icon ${iconClasses.join(' ')}` }])
    }
    children.push(label)
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'file-ref',
        title: fileRefTextParts(attrs).full,
        class: 'file-ref-chip'
      }),
      ...children
    ]
  },

  renderText({ node }) {
    // 纯文本序列化：chip 即其完整路径（含行号范围），出站消息直接可用
    return fileRefTextParts(node.attrs as FileRefAttrs).full
  },

  addCommands() {
    return {
      insertFileRef:
        (ref: FileRefAttrs) =>
        ({ commands }) =>
          commands.insertContent([
            { type: this.name, attrs: ref },
            { type: 'text', text: ' ' }
          ])
    }
  }
})
