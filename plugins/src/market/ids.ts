/** market 插件跨文件共享 id（同 id 多处使用必须进 ids.ts） */

/** 安装确认 modal 的 Overlay 条目 id（区内唯一，带插件前缀） */
export const OVERLAY_CONFIRM = 'market-install-confirm'

/** 团队安装覆盖确认 modal 的 Overlay 条目 id（区内唯一，带插件前缀） */
export const MODAL_TEAM_CONFIRM = 'market-team-confirm'

/** 成员安装覆盖确认 modal 的 Overlay 条目 id（区内唯一，带插件前缀） */
export const MODAL_AGENT_CONFIRM = 'market-agent-confirm'

/** 技能安装覆盖确认 modal 的 Overlay 条目 id（区内唯一，带插件前缀） */
export const MODAL_SKILL_CONFIRM = 'market-skill-confirm'

/** 专用源邀请码输入 modal 的 Overlay 条目 id（区内唯一，带插件前缀） */
export const MODAL_PAT_CONFIRM = 'market-pat-confirm'

/** 发布 modal 的 Overlay 条目 id（§3：本地包打包发布/衍生改名发布，区内唯一） */
export const MODAL_PUBLISH = 'market-publish'

/** 投递 modal 的 Overlay 条目 id（§4 回流：进化版本投递原作者，区内唯一） */
export const MODAL_SUBMIT = 'market-submit'

/** 收件箱 modal 的 Overlay 条目 id（§4 包主审核投递，区内唯一） */
export const MODAL_INBOX = 'market-inbox'

/** MindX 账号绑定 Sheet 的条目 id（区内唯一，带插件前缀） */
export const SHEET_ACCOUNT = 'market-account'

/** 登录遮挡 Sheet（AuthRequiredSheet；需要账号身份的插件拉起）的条目 id（区内唯一，带插件前缀） */
export const SHEET_AUTH_REQUIRED = 'market-auth-required'

/** 内嵌网页 Sheet（服务条款/隐私声明等法律文本）的条目 id（区内唯一，带插件前缀） */
export const SHEET_BROWSER = 'market-browser'

/** 添加连接（手动输入另一台设备地址）modal 的 Overlay 条目 id（区内唯一，带插件前缀） */
export const MODAL_DEVICE_ADDRESS = 'market-device-address'
