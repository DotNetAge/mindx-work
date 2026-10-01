/**
 * import.meta.glob 最小类型增强。
 * 依据：providerIcons.ts 用 eager/query/import 三选项批量导入 SVG；
 * 本包作用域内无 vite 依赖（vite 7 安装于 app/，其 client.d.ts 亦不再
 * 内联 glob 声明），故手写与 Vite 7 importGlob 语义一致的最小签名。
 */
interface ImportMeta {
  glob(
    pattern: string,
    options?: { eager?: boolean; query?: string; import?: string; as?: string },
  ): Record<string, unknown>
}
