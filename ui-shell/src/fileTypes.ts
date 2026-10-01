/**
 * 文件类型接管注册表：插件装配期声明自己接管的文件扩展名 → 打开服务名。
 * 渲染无关（同 services 通道的插件间共享性质），打开路由方（explorer 文件树、
 * chatflow file_open）按注册表分派——接管扩展名命中声明插件，未接管一律
 * codeeditor 兜底。市场插件装入即注册、停用即摘除，路由代码零改动。
 */

/** 文件类型接管上下文（AppShell 第七通道） */
export interface FileTypesContext {
  /** 注册接管扩展名（ext 归一小写；同一 ext 重复注册 = 编程错误，抛出）；
   * 返回摘除函数（插件停用清理时调用） */
  register(exts: readonly string[], serviceId: string): () => void
  /** 查扩展名对应的服务名（未接管返回 undefined） */
  serviceOf(ext: string): string | undefined
}

export function createFileTypesContext(): FileTypesContext {
  const map = new Map<string, string>()
  return {
    register(exts, serviceId) {
      if (!serviceId) {
        throw new Error('文件类型注册的服务名不能为空')
      }
      for (const raw of exts) {
        const ext = raw.toLowerCase()
        if (!ext) {
          throw new Error('注册的文件扩展名不能为空')
        }
        if (map.has(ext)) {
          throw new Error(`扩展名 "${ext}" 重复注册（${map.get(ext)} 与 ${serviceId} 冲突）`)
        }
        map.set(ext, serviceId)
      }
      return () => {
        for (const raw of exts) map.delete(raw.toLowerCase())
      }
    },
    serviceOf(ext) {
      return map.get(ext.toLowerCase())
    },
  }
}
