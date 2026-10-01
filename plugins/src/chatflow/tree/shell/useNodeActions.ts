// useNodeActions —— 节点操作分派器（PR §4.1：registry/actions.ts 声明 id，此处执行）。
//
// registry 保持薄表（声明层），视图层关注点（剪贴板、编辑器命令、store 路由）收在本文件。
// 全部处理器基于节点结构化字段工作，不回读原始事件（PR §2.1 边界约束）。
//
// mindx-work 适配（二期 A）：
// - 纯前端能力（剪贴板 / 下载 / 外链）真实实现；
// - 编辑器通道（打开文件 / reveal）与数据层（重跑 / 子会话路由 / 用量报告 /
//   保存项目）依赖四期 store 与 daemon 接线，二期 A 以提示占位——
// - write/edit 的 diff 查看（Details「变更」面板定位）与回滚已接线：
//   经 chatflow.store 的 diffFocusPath 通道 + session.rollback_files 动作。

import { ElMessage, ElMessageBox } from 'element-plus'
import { useShell } from '@mindx-work/ui-shell-vue'
import { useChatflowStore } from '../../store'
import type { NodeActionId } from '../registry/actions'
import type { TreeNode } from '../types'
import type { BashToolNode, EditToolNode, RunScriptToolNode, SkillToolNode, WriteToolNode } from '../types/tool'
import type { ContentNode } from '../types/content'

/** 剪贴板写入 + 轻提示 */
async function copyText(text: string, tip = '已复制'): Promise<void> {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(tip)
  } catch {
    ElMessage.error('复制失败')
  }
}

/** 编辑器通道占位（四期接线：monaco workbench 打开文件 / 定位行 / diff 对照） */
function editorPending(feature: string, detail?: string): void {
  ElMessage.info(detail ? `${feature}待接入: ${detail}` : `${feature}待接入`)
}

/**
 * 操作分派入口：NodeCard 的操作组点击 / 展开态视图内建操作（error 三操作等）统一路由。
 * 未知 id 静默忽略（registry 声明与分派的增量不同步时不出错）。
 */
export function useNodeActions() {
  // 联动通道：跳转 Details「变更」面板定位 diff（shell + store 均为 setup 期注入，
  // 本 composable 仅在组件 setup 中调用——ChatRound / TreeNodeItem 两调用点已核实）
  const shell = useShell()
  const chatStore = useChatflowStore()

  const dispatch = async (node: TreeNode, id: NodeActionId): Promise<void> => {
    switch (id) {
      // ── 文件类（编辑器通道四期接线，二期 A 占位） ──
      case 'open-file-at': {
        // read：定位读取起始行；write/edit：定位文件
        if (node.type === 'tool.read') editorPending('打开文件', node.path)
        else if (node.type === 'tool.write') editorPending('打开文件', node.filePath)
        else if (node.type === 'tool.edit') editorPending('打开文件', node.filePath)
        break
      }
      case 'open-diff':
        if (node.type === 'tool.write' || node.type === 'tool.edit') {
          const n = node as WriteToolNode | EditToolNode
          // 跳转 Details「变更」面板并定位该文件（store.diffFocusPath 通道，
          // DiffPanel watch 消费；面板未注册时 Detail.show 静默，无副作用）
          chatStore.diffFocusPath = n.filePath
          shell.Detail.show('diff-detail')
        }
        break
      case 'rollback':
        if (node.type === 'tool.write' || node.type === 'tool.edit') {
          const n = node as WriteToolNode | EditToolNode
          // 回滚该文件（session.rollback_files，破坏性操作确认弹窗）
          try {
            await ElMessageBox.confirm(
              `将「${n.filePath.split('/').pop() || n.filePath}」回滚到修改前内容，修改将丢失且不可恢复。`,
              '回滚文件',
              {
                confirmButtonText: '回滚',
                cancelButtonText: '取消',
                type: 'warning',
                confirmButtonClass: 'el-button--danger',
              },
            )
          } catch {
            break
          }
          try {
            await chatStore.rollbackSessionFiles(chatStore.activeSessionId, [n.filePath])
            ElMessage({ message: '已回滚', type: 'success', duration: 2000 })
          } catch {
            ElMessage({ message: '回滚失败', type: 'error', duration: 2000 })
          }
        }
        break
      case 'reveal':
        if (node.type === 'tool.ls') editorPending('在资源管理器中显示', node.path)
        break
      // ── 文本类（纯前端能力，真实实现） ──
      case 'copy':
        if (node.type === 'content' || node.type === 'thinking') {
          void copyText(node.content)
        }
        break
      case 'copy-command':
        if (node.type === 'tool.bash') void copyText(node.command, '已复制命令')
        else if (node.type === 'tool.run_script') void copyText([node.script, node.args].filter(Boolean).join(' '), '已复制脚本命令')
        break
      case 'rerun': {
        if (node.type !== 'tool.bash') break
        const n = node as BashToolNode
        if (n.command) {
          // 重发命令依赖 ChatFlow store 的发送动作（四期接线）
          editorPending('重新执行命令', n.command)
        }
        break
      }
      // ── 链接 / 技能 / 子会话 / 任务 / 定时 ──
      case 'open-url':
        if (node.type === 'tool.web_fetch' && node.url) {
          // 链接统一路由 web-viewer（详情轨道），不再弹系统新窗口
          chatStore.openUrl(node.url)
        }
        break
      case 'open-skill-doc': {
        const n = node as SkillToolNode
        if (n.rootDir) editorPending('查看技能文档', n.rootDir + '/SKILL.md')
        break
      }
      case 'open-script-dir': {
        const n = node as RunScriptToolNode
        if (n.skillName) {
          // 技能目录由 daemon 侧 skills 根定位，前端无 rootDir 字段（builder 已核实），
          // 降级用知识库检索同源的 SKILL 目录定位：直接提示 + 打开技能文档
          ElMessage.info('技能: ' + n.skillName)
        }
        break
      }
      case 'open-subsession': {
        if (node.type === 'subagent') {
          editorPending('打开子会话', (node as { agentName?: string }).agentName)
        } else if (node.type === 'collect') {
          // 子会话路由依赖会话层（四期：ChatFlow store 换会话）
          editorPending('打开子会话')
        }
        break
      }
      case 'open-tasks':
        if (node.type === 'task' || node.type === 'tool.task_query') {
          // Tasks 看板浮窗随四期 Tasks 数据接入
          editorPending('打开 Tasks 视图')
        }
        break
      case 'open-schedule':
        // 定时任务视图随四期接线
        editorPending('打开定时任务')
        break
      // ── 阻塞详情 ──
      case 'details':
        void (node as { decision?: string }).decision
        break
      case 'view-qa':
        void (node as { answers?: unknown[] }).answers
        break
      // ── error 三操作（ChatRound 现役链路上抛，由 TreeView 转发） ──
      case 'retry':
      case 'ignore':
      case 'open-settings':
        // 由 NodeCard 以独立事件上抛（需要原始消息 id，节点 id 规则 error_<mid>）
        break
      // ── content 答案形态（speak 由视图 expose 方法承接，此处兜底其余） ──
      case 'speak':
        break
      case 'download-md': {
        const n = node as ContentNode
        if (n.content) {
          const blob = new Blob([n.content], { type: 'text/markdown;charset=utf-8' })
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = `${(n.summary || '答案').slice(0, 30).replace(/[\\/:*?"<>|]/g, '') || '答案'}.md`
          a.click()
          URL.revokeObjectURL(a.href)
        }
        break
      }
      case 'save-project': {
        // 平移自现役 ResultView.saveToProject：文件名对话框 → 写入当前项目目录；
        // 写盘通道依赖 daemon 文件服务（四期随数据层接线），二期 A 打桩到下载兜底
        const n = node as ContentNode
        if (!n.content) break
        const defaultName = (n.summary || '答案').slice(0, 30).replace(/[\\/:*?"<>|]/g, '') || '答案'
        try {
          const { value } = await ElMessageBox.prompt('保存到当前项目目录', '保存为 Markdown', {
            inputValue: `${defaultName}.md`,
            confirmButtonText: '保存',
            cancelButtonText: '取消',
            inputPattern: /^[^\\/:*?"<>|]+$/,
            inputErrorMessage: '文件名包含非法字符',
          })
          const name = (value || '').trim()
          if (!name) break
          const finalName = name.endsWith('.md') ? name : `${name}.md`
          editorPending('保存到项目', finalName)
        } catch {
          // 用户取消对话框：静默
        }
        break
      }
    }
  }

  /** error 节点 id → 原始消息 id（builder 规则：error_<messageId>），供现役重试链路定位 */
  function errorMessageId(node: { id: string }): string {
    return node.id.replace(/^error_/, '')
  }

  return { dispatch, errorMessageId }
}
