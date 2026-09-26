/**
 * 供应商品牌 Logo（lobe-icons 官方 SVG，本地 assets/provider-icons/，MIT 许可）。
 * 移植自 mindx-desktop utils/providerIcons.ts：批量导入打包为 URL，未收录返回空串由调用方首字母兜底。
 */

const iconModules = import.meta.glob('./assets/provider-icons/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

// provider name（统一小写比对）→ 本地图标文件名；同一供应商多个 name 映射到同一图标
const PROVIDER_ICONS: Record<string, string> = {
  openai: 'openai.svg',
  ollama: 'ollama.svg',
  deepseek: 'deepseek-color.svg',
  anthropic: 'anthropic.svg',
  claude: 'claude-color.svg',
  zhipu: 'zhipu-color.svg',
  bigmodel: 'zhipu-color.svg',
  chatglm: 'chatglm-color.svg',
  qwen: 'qwen-color.svg',
  dashscope: 'alibaba-color.svg',
  alibaba: 'alibaba-color.svg',
  bailian: 'alibaba-color.svg',
  moonshot: 'kimi-color.svg',
  kimi: 'kimi-color.svg',
  groq: 'groq.svg',
  mistral: 'mistral-color.svg',
  cohere: 'cohere-color.svg',
  openrouter: 'openrouter-color.svg',
  gemini: 'gemini-color.svg',
  google: 'gemini-color.svg',
  baichuan: 'baichuan-color.svg',
  minimax: 'minimax-color.svg',
  doubao: 'doubao-color.svg',
  hunyuan: 'hunyuan-color.svg',
  tencent: 'tencentcloud-color.svg',
  tencentcloud: 'tencentcloud-color.svg',
  volcengine: 'volcengine-color.svg',
  siliconflow: 'siliconcloud-color.svg',
  silicon: 'siliconcloud-color.svg',
  siliconcloud: 'siliconcloud-color.svg',
  spark: 'spark-color.svg',
  iflytek: 'spark-color.svg',
  stepfun: 'stepfun-color.svg',
  baidu: 'baidu-color.svg',
  ernie: 'baidu-color.svg',
}

/** 取供应商的图标 URL；未收录返回空串 */
export function providerIcon(name: string): string {
  const file = PROVIDER_ICONS[name.toLowerCase()]
  if (!file) return ''
  return iconModules[`./assets/provider-icons/${file}`] || ''
}
