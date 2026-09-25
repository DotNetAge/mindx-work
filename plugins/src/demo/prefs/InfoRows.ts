/**
 * 通用信息行工厂：DSH 设置面板大量行是"标题+说明+右值 chip"形态
 * （GeneralSection 行结构）。demo 用函数式组件批量生成，避免重复文件。
 * 函数式组件符合插件契约（row.component 仅要求可渲染）。
 */
import { h } from 'vue'
import { MxIcon } from '@mindx-work/ui-shell-vue'

interface InfoRowOptions {
  /** 行标题（14px 主文字） */
  title: string
  /** 行说明（12px tertiary） */
  desc: string
  /** 右侧 chip 展示值 */
  value: string
}

/** 生成一个标准设置行：.mx-pref-row 骨架 + .mx-pill 值 chip（PermissionSelect 几何） */
function createInfoRow(options: InfoRowOptions) {
  return () =>
    h('div', { class: 'mx-pref-row' }, [
      h('div', { class: 'mx-pref-label' }, [
        h('span', { class: 'mx-pref-title' }, options.title),
        h('span', { class: 'mx-pref-desc' }, options.desc),
      ]),
      h('button', { type: 'button', class: 'mx-pill' }, [
        h('span', options.value),
        h(MxIcon, { name: 'lucide:chevron-down', size: 16 }),
      ]),
    ])
}

/** 模型页行示例 */
export const ModelRow = createInfoRow({
  title: '默认模型',
  desc: '新会话使用的默认模型',
  value: 'mindx-chat',
})

/** Agent 预设页行示例 */
export const AgentRow = createInfoRow({
  title: '默认预设',
  desc: '新会话加载的 Agent 预设',
  value: '通用助手',
})

/** 桌面设置页行示例 */
export const DesktopRow = createInfoRow({
  title: '开机自启',
  desc: '登录系统后自动运行',
  value: '关闭',
})
