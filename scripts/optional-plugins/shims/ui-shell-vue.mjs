/**
 * @mindx-work/ui-shell-vue 外部化 shim（可选件构建时 alias → 本文件）：
 * useShell / useService 为闭包绑定壳实例的实现（与 reactity.ts 同语义，不走 inject）；
 * MxIcon / ToolbarIconButton 为壳同一组件实例（同实例才保持主题与响应式一致）。
 */
const bridge = globalThis.__MINDX_BRIDGE__
if (!bridge) {
  throw new Error('运行期桥缺失：__MINDX_BRIDGE__ 未挂载（可选件必须在 MindX Work 壳内激活）')
}

export const MxIcon = bridge.uiShellVue.MxIcon
export const ToolbarIconButton = bridge.uiShellVue.ToolbarIconButton
export function useShell() {
  return bridge.uiShellVue.useShell()
}
export function useService(name) {
  return bridge.uiShellVue.useService(name)
}
export function useShellVersion() {
  const shell = useShell()
  const version = bridge.vue.ref(shell.version)
  const stop = shell.subscribe(() => {
    version.value = shell.version
  })
  bridge.vue.onUnmounted(stop)
  return version
}
export function useShellData(read) {
  const version = useShellVersion()
  return bridge.vue.computed(() => {
    void version.value
    return read()
  })
}
export default bridge.uiShellVue
