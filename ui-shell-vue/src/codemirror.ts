/**
 * CodeMirror 6 语言扩展映射：按文件扩展名返回语法高亮扩展。
 * 两段来源：
 * 1) 官方 lang-* 包（17 包 / 31 扩展名，优先使用——解析质量高于 legacy 模式）；
 * 2) @codemirror/legacy-modes 全量接入（StreamLanguage 包装，100 解析器 / 145 扩展名），
 *    覆盖官方包之外的绝大多数文本语言。合计 176 个扩展名。
 * 未知扩展返回空数组 = 纯文本（基础编辑能力不受影响）。
 * 边界：特殊文件名（Dockerfile / CMakeLists.txt / Gemfile 等无扩展名）不在
 * extOf 路由能力内，不在此表；nginx / ttcn-cfg 等共用 .conf 归 INI 族；
 * Elixir / Zig / GraphQL 等不在 legacy-modes 内的语言暂无高亮。
 */
import { StreamLanguage } from '@codemirror/language'
import type { StreamParser } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
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

// legacy-modes 导入（导出名逐个核对自包内 .d.ts，@codemirror/legacy-modes@6.5.4）
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { diff } from '@codemirror/legacy-modes/mode/diff'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { perl } from '@codemirror/legacy-modes/mode/perl'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { csharp, scala, kotlin, dart, objectiveC, objectiveCpp, ceylon, squirrel, shader, nesC } from '@codemirror/legacy-modes/mode/clike'
import { clojure } from '@codemirror/legacy-modes/mode/clojure'
import { cmake } from '@codemirror/legacy-modes/mode/cmake'
import { cobol } from '@codemirror/legacy-modes/mode/cobol'
import { coffeeScript } from '@codemirror/legacy-modes/mode/coffeescript'
import { commonLisp } from '@codemirror/legacy-modes/mode/commonlisp'
import { crystal } from '@codemirror/legacy-modes/mode/crystal'
import { cypher } from '@codemirror/legacy-modes/mode/cypher'
import { d as langD } from '@codemirror/legacy-modes/mode/d'
import { erlang } from '@codemirror/legacy-modes/mode/erlang'
import { eiffel } from '@codemirror/legacy-modes/mode/eiffel'
import { elm } from '@codemirror/legacy-modes/mode/elm'
import { factor } from '@codemirror/legacy-modes/mode/factor'
import { forth } from '@codemirror/legacy-modes/mode/forth'
import { fortran } from '@codemirror/legacy-modes/mode/fortran'
import { gas } from '@codemirror/legacy-modes/mode/gas'
import { gherkin } from '@codemirror/legacy-modes/mode/gherkin'
import { groovy } from '@codemirror/legacy-modes/mode/groovy'
import { haskell } from '@codemirror/legacy-modes/mode/haskell'
import { haxe, hxml } from '@codemirror/legacy-modes/mode/haxe'
import { http } from '@codemirror/legacy-modes/mode/http'
import { idl } from '@codemirror/legacy-modes/mode/idl'
import { jinja2 } from '@codemirror/legacy-modes/mode/jinja2'
import { julia } from '@codemirror/legacy-modes/mode/julia'
import { liveScript } from '@codemirror/legacy-modes/mode/livescript'
import { mathematica } from '@codemirror/legacy-modes/mode/mathematica'
import { mbox } from '@codemirror/legacy-modes/mode/mbox'
import { mirc } from '@codemirror/legacy-modes/mode/mirc'
import { oCaml, fSharp, sml } from '@codemirror/legacy-modes/mode/mllike'
import { modelica } from '@codemirror/legacy-modes/mode/modelica'
import { mscgen, msgenny, xu } from '@codemirror/legacy-modes/mode/mscgen'
import { nsis } from '@codemirror/legacy-modes/mode/nsis'
import { ntriples } from '@codemirror/legacy-modes/mode/ntriples'
import { octave } from '@codemirror/legacy-modes/mode/octave'
import { oz } from '@codemirror/legacy-modes/mode/oz'
import { pascal } from '@codemirror/legacy-modes/mode/pascal'
import { pegjs } from '@codemirror/legacy-modes/mode/pegjs'
import { pig } from '@codemirror/legacy-modes/mode/pig'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf'
import { pug } from '@codemirror/legacy-modes/mode/pug'
import { puppet } from '@codemirror/legacy-modes/mode/puppet'
import { cython } from '@codemirror/legacy-modes/mode/python'
import { q as langQ } from '@codemirror/legacy-modes/mode/q'
import { r as langR } from '@codemirror/legacy-modes/mode/r'
import { rpmSpec } from '@codemirror/legacy-modes/mode/rpm'
import { scheme } from '@codemirror/legacy-modes/mode/scheme'
import { sieve } from '@codemirror/legacy-modes/mode/sieve'
import { smalltalk } from '@codemirror/legacy-modes/mode/smalltalk'
import { sparql } from '@codemirror/legacy-modes/mode/sparql'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { stylus } from '@codemirror/legacy-modes/mode/stylus'
import { tcl } from '@codemirror/legacy-modes/mode/tcl'
import { textile } from '@codemirror/legacy-modes/mode/textile'
import { tiddlyWiki } from '@codemirror/legacy-modes/mode/tiddlywiki'
import { turtle } from '@codemirror/legacy-modes/mode/turtle'
import { ttcn } from '@codemirror/legacy-modes/mode/ttcn'
import { vb } from '@codemirror/legacy-modes/mode/vb'
import { vbScript } from '@codemirror/legacy-modes/mode/vbscript'
import { velocity } from '@codemirror/legacy-modes/mode/velocity'
import { verilog, tlv } from '@codemirror/legacy-modes/mode/verilog'
import { vhdl } from '@codemirror/legacy-modes/mode/vhdl'
import { wast } from '@codemirror/legacy-modes/mode/wast'
import { webIDL } from '@codemirror/legacy-modes/mode/webidl'
import { xQuery } from '@codemirror/legacy-modes/mode/xquery'
import { yacas } from '@codemirror/legacy-modes/mode/yacas'
import { z80, ez80 } from '@codemirror/legacy-modes/mode/z80'
import { asn1 } from '@codemirror/legacy-modes/mode/asn1'
import { asciiArmor } from '@codemirror/legacy-modes/mode/asciiarmor'
import { brainfuck } from '@codemirror/legacy-modes/mode/brainfuck'
import { apl } from '@codemirror/legacy-modes/mode/apl'
import { dylan } from '@codemirror/legacy-modes/mode/dylan'
import { ebnf } from '@codemirror/legacy-modes/mode/ebnf'
import { ecl } from '@codemirror/legacy-modes/mode/ecl'
import { fcl } from '@codemirror/legacy-modes/mode/fcl'

/** legacy 模式包装（StreamParser → 扩展工厂） */
function legacy(p: StreamParser<unknown>): () => Extension {
  return () => StreamLanguage.define(p)
}

/** 扩展名 → 语言扩展工厂（小写扩展名键） */
const LANG_BY_EXT: Record<string, () => Extension> = {
  // ── 官方 lang-* 包（31 扩展名）──────────────────────────────────────────
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

  // ── legacy-modes 全量段 ─────────────────────────────────────────────────
  // 脚本与配置
  sh: legacy(shell),
  bash: legacy(shell),
  zsh: legacy(shell),
  ksh: legacy(shell),
  toml: legacy(toml),
  ini: legacy(properties),
  conf: legacy(properties),
  properties: legacy(properties),
  cfg: legacy(properties),
  dockerfile: legacy(dockerFile),
  cmake: legacy(cmake),
  proto: legacy(protobuf),
  // COBOL（cbl/cob/cpy 源文件扩展名）
  cbl: legacy(cobol),
  cob: legacy(cobol),
  // 版本与差异
  diff: legacy(diff),
  patch: legacy(diff),
  spec: legacy(rpmSpec),
  // C 系家族（官方 cpp/java 包已覆盖 c/cpp/h/java）
  cs: legacy(csharp),
  scala: legacy(scala),
  kt: legacy(kotlin),
  kts: legacy(kotlin),
  dart: legacy(dart),
  m: legacy(objectiveC),
  mm: legacy(objectiveCpp),
  nc: legacy(nesC),
  ceylon: legacy(ceylon),
  nut: legacy(squirrel),
  glsl: legacy(shader),
  frag: legacy(shader),
  vert: legacy(shader),
  // 函数式语言
  clj: legacy(clojure),
  cljs: legacy(clojure),
  edn: legacy(clojure),
  lisp: legacy(commonLisp),
  lsp: legacy(commonLisp),
  el: legacy(commonLisp),
  cl: legacy(commonLisp),
  ml: legacy(oCaml),
  mli: legacy(oCaml),
  fs: legacy(fSharp),
  fsi: legacy(fSharp),
  fsx: legacy(fSharp),
  sml: legacy(sml),
  sig: legacy(sml),
  hs: legacy(haskell),
  elm: legacy(elm),
  erl: legacy(erlang),
  hrl: legacy(erlang),
  cr: legacy(crystal),
  jl: legacy(julia),
  scm: legacy(scheme),
  ss: legacy(scheme),
  rkt: legacy(scheme),
  oz: legacy(oz),
  factor: legacy(factor),
  forth: legacy(forth),
  fth: legacy(forth),
  // 通用脚本语言
  lua: legacy(lua),
  pl: legacy(perl),
  pm: legacy(perl),
  pod: legacy(perl),
  rb: legacy(ruby),
  gemspec: legacy(ruby),
  rake: legacy(ruby),
  coffee: legacy(coffeeScript),
  ls: legacy(liveScript),
  tcl: legacy(tcl),
  ps1: legacy(powerShell),
  psm1: legacy(powerShell),
  psd1: legacy(powerShell),
  vb: legacy(vb),
  vbs: legacy(vbScript),
  d: legacy(langD),
  pas: legacy(pascal),
  pp: legacy(puppet),
  pig: legacy(pig),
  q: legacy(langQ),
  r: legacy(langR),
  swift: legacy(swift),
  groovy: legacy(groovy),
  gradle: legacy(groovy),
  e: legacy(eiffel),
  st: legacy(smalltalk),
  hx: legacy(haxe),
  hxml: legacy(hxml),
  // TTCN-3 通信测试语言
  ttcn: legacy(ttcn),
  // 科学与硬件工程
  f: legacy(fortran),
  for: legacy(fortran),
  f77: legacy(fortran),
  f90: legacy(fortran),
  f95: legacy(fortran),
  s: legacy(gas),
  asm: legacy(gas),
  mo: legacy(modelica),
  v: legacy(verilog),
  tlv: legacy(tlv),
  vhd: legacy(vhdl),
  vhdl: legacy(vhdl),
  octave: legacy(octave),
  nb: legacy(mathematica),
  wl: legacy(mathematica),
  ys: legacy(yacas),
  z80: legacy(z80),
  ez80: legacy(ez80),
  mrc: legacy(mirc),
  // 标记与模板
  j2: legacy(jinja2),
  jinja: legacy(jinja2),
  jinja2: legacy(jinja2),
  pug: legacy(pug),
  jade: legacy(pug),
  tex: legacy(stex),
  sty: legacy(stex),
  cls: legacy(stex),
  textile: legacy(textile),
  tid: legacy(tiddlyWiki),
  vm: legacy(velocity),
  vtl: legacy(velocity),
  styl: legacy(stylus),
  feature: legacy(gherkin),
  asn: legacy(asn1({})),
  asn1: legacy(asn1({})),
  // 数据与查询
  nt: legacy(ntriples),
  ttl: legacy(turtle),
  sparql: legacy(sparql),
  rq: legacy(sparql),
  cypher: legacy(cypher),
  // XQuery
  xq: legacy(xQuery),
  xqm: legacy(xQuery),
  xquery: legacy(xQuery),
  // 网络与协议
  http: legacy(http),
  idl: legacy(idl),
  webidl: legacy(webIDL),
  nsi: legacy(nsis),
  nsh: legacy(nsis),
  // 杂项专用语言
  msc: legacy(mscgen),
  msgenny: legacy(msgenny),
  xu: legacy(xu),
  ebnf: legacy(ebnf),
  ecl: legacy(ecl),
  fcl: legacy(fcl),
  dylan: legacy(dylan),
  pegjs: legacy(pegjs),
  pyx: legacy(cython),
  sieve: legacy(sieve),
  apl: legacy(apl),
  asc: legacy(asciiArmor),
  pgp: legacy(asciiArmor),
  bf: legacy(brainfuck),
  wast: legacy(wast),
  wat: legacy(wast),
  mbox: legacy(mbox),
}

/** 取扩展名对应语言扩展（无匹配 = 空数组） */
export function languageFor(ext: string): Extension[] {
  const factory = LANG_BY_EXT[ext.toLowerCase()]
  return factory ? [factory()] : []
}
