/**
 * 向导共享类型与凭据→daemon 配置映射（与主进程 probe.ts 报告同构）。
 * IMPORT_MAP 是"验证通过的凭据键 → daemon provider/model 落盘参数"的唯一定义处；
 * bool 字段全部显式传值（daemon 侧 Go 结构体普通 bool，缺省即 false——AGENTS.md 纪律）。
 */

/** 主进程探测报告（probe.ts ProbeReport 渲染层可见形态） */
export interface ProbeReport {
  platform: string
  daemonAlive: boolean
  mindxDirExists: boolean
  wslRegistryExists: boolean
  dockerAvailable: boolean
  dockerContainers: DockerContainerHit[]
  wslAvailable: boolean
  wslDistros: string[]
  credentials: CredentialHit[]
}

export interface CredentialHit {
  key: string
  source: 'shellrc' | 'env'
}

/** 本机正在运行的智能主机官方镜像容器（probe.ts DockerContainerHit 同构） */
export interface DockerContainerHit {
  name: string
  hostPort: number | null
  alive: boolean
}

/** 验证回执（probe.ts verifyCredential 同构） */
export interface VerifyResult {
  ok: boolean
  reason?: string
  modelHint?: string
}

/** 凭据键 → daemon 侧落盘参数（provider 名与 models 插件供应商命名对齐） */
export interface ImportPlan {
  provider: string
  providerTitle: string
  baseUrl: string
  model: string
  modelTitle: string
}

/** 有自动验证端点的凭据键才进导入映射（MINIMAX/GEMINI 暂不支持，见 probe.ts） */
export const IMPORT_MAP: Record<string, ImportPlan> = {
  DEEPSEEK_API_KEY: {
    provider: 'deepseek',
    providerTitle: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    modelTitle: 'DeepSeek Chat',
  },
  OPENAI_API_KEY: {
    provider: 'openai',
    providerTitle: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    modelTitle: 'GPT-4o mini',
  },
  ANTHROPIC_API_KEY: {
    provider: 'anthropic',
    providerTitle: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-3-5-haiku-20241022',
    modelTitle: 'Claude 3.5 Haiku',
  },
  MOONSHOT_API_KEY: {
    provider: 'kimi',
    providerTitle: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    modelTitle: 'Moonshot v1 8K',
  },
  DASHSCOPE_API_KEY: {
    provider: 'dashscope',
    providerTitle: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-turbo',
    modelTitle: 'Qwen Turbo',
  },
  ZHIPUAI_API_KEY: {
    provider: 'bigmodel',
    providerTitle: '智谱',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    modelTitle: 'GLM-4 Flash',
  },
  ARK_API_KEY: {
    provider: 'ark',
    providerTitle: '火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-lite-4k',
    modelTitle: '豆包 lite 4K',
  },
  SILICONFLOW_API_KEY: {
    provider: 'siliconflow',
    providerTitle: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    modelTitle: 'Qwen2.5 7B',
  },
  OPENROUTER_API_KEY: {
    provider: 'openrouter',
    providerTitle: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    modelTitle: 'GPT-4o mini (OR)',
  },
}

/** daemon 本机端点（与 plugins/src/connection/daemon.ts 同值；向导独立窗口不引壳服务） */
export const LOCAL_DAEMON_URL = 'ws://localhost:1314/ws'
