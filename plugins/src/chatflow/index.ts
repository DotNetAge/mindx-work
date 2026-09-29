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
import ProductsPanel from './detail/ProductsPanel.vue'
import ToolbarTrailing from './ToolbarTrailing.vue'
import { CHATFLOW_HOME_ID, CHATFLOW_TASKS_SECTION_ID, PRODUCT_DETAIL_ID } from './ids'
import { createChatflowService } from './store'

export const chatflowPlugin: VuePlugin = (ctx) => {
  // Content：对话流页面（title 呈现于 Toolbar）
  ctx.Content.add({ id: CHATFLOW_HOME_ID, order: 100, title: '对话', component: ChatFlowPage })

  // Detail：「产物」tab（order 106，概念框架 §6.1 三段：对话产物/技能/最近文件）。
  // owner=对话条目：本插件的 Detail 层——激活对话时轨道联动切到本层（层模型激活链）
  ctx.Detail.add({
    id: PRODUCT_DETAIL_ID,
    order: 106,
    owner: CHATFLOW_HOME_ID,
    title: '产物',
    icon: 'lucide:package',
    component: ProductsPanel,
  })

  // Toolbar 尾段：task 图标打开会话产物 tab
  ctx.Toolbar.add({ id: 'chatflow-toolbar-products', slot: 'trailing', order: 102, component: ToolbarTrailing })

  // Sidebar：Tasks 节（分节组件席位，概念框架 §7.2）。
  // 全量分组制会话列表（按目录名）+「最近讨论」捷径区 + 行四要素
  // （任务名 / 运行状态 / 最后活动时间 / 未读标记）+ Agent 切换器 + 新会话按钮卡，
  // 数据源 = chatflow store（session.list 全量 + 实时事件）。折叠成 rail 时
  // 组件经 compact 自适配为「新会话」图标钮。
  ctx.Sidebar.add({
    id: CHATFLOW_TASKS_SECTION_ID,
    order: 100,
    icon: 'lucide:list-todo',
    component: TasksSection,
    rows: [],
  })

  // services：chatflow store 延迟外壳（本 store 带 inject 依赖，首次实例化
  // 必须由组件 setup 触发——装配期 Pinia 未安装，禁止此时创建；消费方为
  // explorer 等详情轨道插件，读 currentProjectDir 跟随当前会话工作区）
  ctx.services.provide('chatflow.store', createChatflowService())

  // 停用清理：席位移除 + 收起 Detail 轨道（若正展示本 tab）
  return () => {
    if (ctx.Detail.activeTabId === PRODUCT_DETAIL_ID) ctx.Detail.hide()
    ctx.Detail.remove(PRODUCT_DETAIL_ID)
    ctx.Toolbar.remove('chatflow-toolbar-products')
  }
}
