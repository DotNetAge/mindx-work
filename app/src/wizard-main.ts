/** 首启向导入口：独立窗口渲染层（electron/src/wizard.ts 加载 wizard.html）。
 * 只做视图与分步状态机；探测/验证/持久化全在主进程 IPC 与 daemon RPC。 */

import { createApp } from 'vue'
import { ElementPlus, ElementPlusZhCn } from '@mindx-work/ui-shell-vue'
import WizardApp from './wizard/WizardApp.vue'

createApp(WizardApp).use(ElementPlus, { locale: ElementPlusZhCn }).mount('#wizard')
