/** models 插件 Overlay 条目 id（modal 互斥，跨文件共享故进 ids.ts） */

/** 供应商新增/编辑表单 modal */
export const MODAL_PROVIDER_FORM = 'models-provider-form'

/** 模型新增/编辑表单 modal（manual 表单与 Ollama 选择器共用一条目，按 store 模式分支） */
export const MODAL_MODEL_FORM = 'models-model-form'

/** 在线模型浏览 modal（七个供应商共用一条目，按 store.onlineVendor 分支） */
export const MODAL_ONLINE_BROWSER = 'models-online-browser'

/** 删除确认 modal */
export const MODAL_CONFIRM = 'models-confirm'
