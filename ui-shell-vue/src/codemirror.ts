/**
 * CodeMirror 6 语言扩展映射：按文件扩展名返回语法高亮扩展（19 种语言 / 31 扩展名，
 * 全部 @codemirror 官方 lang-* 包）。未知扩展返回空数组 = 纯文本（基础编辑能力不受影响）。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { go } from '@codemirror/lang-go'
import { cpp } from '@codemirror/lang-cpp'
import { java } from '@codemirror/lang-java'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { php } from '@codemirror/lang-php'
import { xml } from '@codemirror/lang-xml'
import { vue } from '@codemirror/lang-vue'
import { css } from '@codemirror/lang-css'
import { sass } from '@codemirror/lang-sass'
import { less } from '@codemirror/lang-less'
import { html } from '@codemirror/lang-html'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import type { Extension } from '@codemirror/state'

/** 扩展名 → 语言扩展工厂（小写扩展名键；全部官方正牌包，无近似归并） */
const LANG_BY_EXT: Record<string, () => Extension> = {
  // markdown
  md: () => markdown({ base: markdownLanguage }),
  markdown: () => markdown({ base: markdownLanguage }),
  // javascript / typescript
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  mjs: () => javascript(),
  cjs: () => javascript(),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  // 后端语言
  py: () => python(),
  go: () => go(),
  rs: () => rust(),
  java: () => java(),
  php: () => php(),
  sql: () => sql(),
  // C/C++（c/h 头文件同族）
  c: () => cpp(),
  h: () => cpp(),
  cpp: () => cpp(),
  hpp: () => cpp(),
  cc: () => cpp(),
  cxx: () => cpp(),
  // 样式（sass 官方包双模式：indented 缺省 false = SCSS 大括号语法，true = Sass 缩进语法）
  css: () => css(),
  scss: () => sass(),
  sass: () => sass({ indented: true }),
  less: () => less(),
  // 标记
  html: () => html(),
  htm: () => html(),
  vue: () => vue(),
  xml: () => xml(),
  // 数据
  json: () => json(),
  yml: () => yaml(),
  yaml: () => yaml(),
}

/** 取扩展名对应语言扩展（无匹配 = 空数组） */
export function languageFor(ext: string): Extension[] {
  const factory = LANG_BY_EXT[ext.toLowerCase()]
  return factory ? [factory()] : []
}
