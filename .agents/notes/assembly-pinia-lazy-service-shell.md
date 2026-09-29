# 装配期 Pinia 未安装：延迟服务外壳范式

日期：2026-09-27｜来源：mindx-work 四个 Detail 席位插件（explorer / markdown / image-viewer / web-viewer）施工实证

## 问题

插件函数体在 `createApp([...])` 时执行，而 `createPinia()` 在 `mountVueApp`（ui-shell-vue/src/mountVueApp.ts）内才安装。因此**插件函数体内 `useXxxStore()` 必炸（无 activePinia）**——scaffold 旧 services 模板生成的 `ctx.services.provide('xxx.data', useXxxStore())` 是系统性缺陷。

连带问题：以服务 provide 的 store，其首次创建可能发生在非 setup 上下文（消费方 store 的 action 经 service 解引用触发），此时 store 函数体内 `useService` / `useShell`（inject 系）全部抛"壳上下文缺失"。

## 范式（三件套）

1. **store 顶部零 inject 依赖**：store 内不出现 useService / useShell。
2. **装配期绑定壳本体**：插件函数体第一行 `bindXxxShell(ctx)` 捕获 VueAppShell；store 内经 `theShell()` 取用——`shell.services.use('daemon.connection')` 是内核方法、无 inject 依赖，拿到壳后随处可调。
3. **provide 延迟外壳**：`createXxxService()` 返回 `{ get store() { return useXxxStore() } }`——getter 把 store 创建推迟到消费方首次解引用（须在挂载后）。

```ts
// index.ts（插件函数体）
bindXxxShell(ctx)                                  // 装配期捕获壳本体
ctx.services.provide('xxx.store', createXxxService())

// store.ts
let shellRef: VueAppShell | null = null
export function bindXxxShell(shell: VueAppShell): void { shellRef = shell }
function theShell(): VueAppShell {
  if (!shellRef) throw new Error('xxx 壳未绑定：插件装配缺失')
  return shellRef
}
export function createXxxService(): XxxService {
  return { get store() { return useXxxStore() } }   // 首次解引用才创建 store
}
```

## 证据

- 实现样本：plugins/src/markdown/store.ts（bind / theShell / 服务外壳），plugins/src/{explorer,image-viewer,web-viewer} 同构
- 装配时序：app/src/main.ts `createApp([...])` vs ui-shell-vue/src/mountVueApp.ts `createPinia()`
- 已回写：mx-plugin-dev references/contract.md §10 与 §10.3、references/examples.md services 场景、scaffold_plugin.py services 模板（生成物入仓 typecheck 全绿后已清理）

## 适用边界

- 普通"仅组件 setup 触发创建"的页面 store 不需要本范式（store 初始化时捕获一次 useService 即可，见 market 范式）。
- 一旦 store 要以服务 provide、或要在 action 里编排壳（Detail.show 等），必须用本范式。
