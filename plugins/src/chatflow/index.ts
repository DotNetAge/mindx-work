/**
 * chatflow 插件：函数 + 可选清理函数（契约第 7 节）。
 * 四期（数据层 + Tasks + 阻塞交互）：Sidebar Tasks 节走分节组件席位——
 * rows 为空、整节由 TasksSection 渲染（全量分组制会话列表 + Agent 切换器 +
 * 新会话按钮卡；壳契约：rows 非空时行数据模型优先）。
 * Content 对话页行 id 与 Tasks 节共享 CHATFLOW_HOME_ID（点击行/新会话均激活对话页）。
 */

import type { VuePlugin } from '@mindx-work/ui-shell-vue'
import ChatFlowPage from './pages/ChatFlowPage.vue'
import TasksSection from './sidebar/TasksSection.vue'
import { CHATFLOW_HOME_ID, CHATFLOW_TASKS_SECTION_ID } from './ids'

export const chatflowPlugin: VuePlugin = (ctx) => {
  // Content：对话流页面（title 呈现于 Toolbar）
  ctx.Content.add({ id: CHATFLOW_HOME_ID, order: 100, title: '对话', component: ChatFlowPage })

  // Sidebar：Tasks 节（分节组件席位，概念框架 §7.2）。
  // 全量分组制会话列表（按目录名）+「最近讨论」捷径区 + 行四要素
  // （任务名 / 运行状态 / 最后活动时间 / 未读标记）+ Agent 切换器 + 新会话按钮卡，
  // 数据源 = chatflow store（session.list 全量 + 实时事件）。折叠成 rail 时
  // 组件经 compact 自适配为「新会话」图标钮。
  ctx.Sidebar.add({
    id: CHATFLOW_TASKS_SECTION_ID,
    order: 100,
    title: 'Tasks',
    icon: 'lucide:list-todo',
    component: TasksSection,
    rows: [],
  })

  return () => {}
}
