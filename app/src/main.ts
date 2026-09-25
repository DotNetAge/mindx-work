/** 组装入口：执行预置插件清单 + 主题机制挂载 + Vue 挂载 */

import { createApp } from '@mindx-work/ui-shell'
import { createThemeController, mountVueApp } from '@mindx-work/ui-shell-vue'
import { demoPlugin } from '@mindx-work/plugins'

// 启动装配：插件冲突与依赖缺失在启动期暴露（契约第 7 节）
const shell = createApp([demoPlugin])

// 主题机制归壳所有（军规 2/3）：控制器以服务形式供设置界面消费
shell.services.provide('shell.theme', createThemeController())

mountVueApp(shell, '#app')
