// chatflow-loader.mjs —— node --test 加载 chatflow TS 源码的模块自定义钩子。
//
// 源码（plugins/src/chatflow/）按源仓惯例使用无后缀相对导入（'./tool-map'），
// Node type stripping 不做后缀探测，需在此补 .ts / /index.ts；
// builder 链上的 'vue' 仅用 reactive 做响应式包装，测试以恒等 stub 替代
// （builder 行为断言不关心响应性，stub 返回原对象便于引用相等断言）。

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const VUE_STUB_SCHEME = 'mx-vue-stub:'

export async function resolve(specifier, context, nextResolve) {
  // vue bare specifier：短路由到内联 stub
  if (specifier === 'vue') {
    return { url: VUE_STUB_SCHEME, shortCircuit: true }
  }
  // 相对导入无后缀：依次探测 .ts / /index.ts
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    for (const suffix of ['.ts', '/index.ts']) {
      const candidate = new URL(specifier + suffix, context.parentURL)
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true }
      }
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === VUE_STUB_SCHEME) {
    return {
      format: 'module',
      source: 'export const reactive = (x) => x\nexport default {}\n',
      shortCircuit: true,
    }
  }
  return nextLoad(url, context)
}
