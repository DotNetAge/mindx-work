/**
 * @mindx-work/ui-shell 外部化 shim（可选件构建时 alias → 本文件）。
 * 当前可选件只消费类型（编译期擦除），运行期无成员；保留文件防 alias 悬空。
 */
const bridge = globalThis.__MINDX_BRIDGE__
if (!bridge) {
  throw new Error('运行期桥缺失：__MINDX_BRIDGE__ 未挂载（可选件必须在 MindX Work 壳内激活）')
}
export default bridge
