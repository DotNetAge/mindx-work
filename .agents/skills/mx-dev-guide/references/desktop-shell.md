# 宿主层壳能力：系统驻留图标（托盘）

## 何时使用

- 为 mindx-work 增加或修改**系统驻留图标菜单项**（macOS 状态栏 / Windows 通知栏）。
- 调整**关窗驻留行为**（点红叉隐藏不退出）、退出入口、托盘唤出主界面的交互。
- 新增其它**原生壳层能力**时参考本模式（main.ts 结构、资源装载、平台分支）。

## 实现地图（全部在 `electron/src/main.ts`）

| 块 | 职责 |
| --- | --- |
| `createWindow()` 内 `win.on('close')` | 关窗拦截为 `win.hide()`（`quitting` 为 false 时），驻留语义的窗口宿主 |
| `showMainWindow()` | 唤出主界面：最小化先还原、隐藏则显示并抢焦点、窗口已销毁则重建 |
| `createTray()` | 创建驻留图标、构建菜单、按平台绑定单击/右键交互 |
| `resolveTrayAsset()` | 托盘图标定位：dev 取仓库 `resources/tray/`，打包取 `process.resourcesPath/tray` |
| `app.on('before-quit')` | 置位 `quitting`，放行窗口真关闭（Cmd+Q / 托盘"退出"共用） |
| `app.on('window-all-closed')` | 非 darwin 兜底退出（hide 拦截后正常不会触发） |

## 图标资源约定（`resources/tray/`）

| 文件 | 用途 | 规格 |
| --- | --- | --- |
| `iconTemplate.png` + `iconTemplate@2x.png` | macOS 状态栏 | 16/32px 纯黑 + alpha 模板图；文件名含 `Template` 系统自动按菜单栏亮暗反色 |
| `icon.png` | Windows 通知栏 | 32px 彩色（深色任务栏可见性优先） |

生成方法：从 `assets/mindx-mono.svg` 渲染（1024 透明底 PAD 128 为应用图标，托盘按上表规格缩放；macOS 模板图把非透明像素统一为黑色、保留 alpha）。

装载：`electron/electron-builder.yml` 的 `extraResources` 把 `../resources/tray` 装到 `Contents/Resources/tray`（打包配置变化须同步 mx-release 技能）。

## 交互模型（定稿）

| 平台 | 单击 | 右键 | 说明 |
| --- | --- | --- | --- |
| macOS | 唤出主界面 **并同时** 弹出菜单 | — | `click` 事件内先 `showMainWindow()` 再 `tray.popUpContextMenu(menu)` |
| Windows | 唤出主界面 | 弹菜单 | `tray.setContextMenu(menu)` 接管右键；左键走 `click` 事件 |

退出入口：托盘菜单"退出 MindX Work"（置位 `quitting` 后 `app.quit()`）与 Cmd+Q（`before-quit` 置位）。

## 增加一个菜单项的步骤

1. 打开 `electron/src/main.ts` 的 `createTray()`，在 `Menu.buildFromTemplate([...])` 中按语义插入：
   - 操作窗口类 → 调 `showMainWindow()` 或扩展窗口行为函数；
   - 应用生命周期类（如退出） → 先 `quitting = true` 再 `app.quit()`；
   - 需要状态展示 → 用 `type: 'checkbox'` / `label` 动态刷新（`menu.getMenuItemById(...)`）。
2. 菜单为两平台共用一份模板，无需按平台拆分。
3. `pnpm --filter @mindx-work/electron build` 后重启 dev（`MX_DEV_URL=http://localhost:5273 npx electron .`）。

## 坑清单（实证）

1. **macOS 上 `setContextMenu` 会让 `click` 事件失效**（原生层接管弹出）：单击需要"弹菜单 + 其它动作"同时发生时，必须改为 `click` 事件内编程 `popUpContextMenu(menu)`，不可两者混用。
2. **`popUpContextMenu` 同步阻塞**（进入菜单跟踪循环）：其它动作必须放在它**之前**执行。
3. **`Tray` 构造在图标资源缺失时抛异常**：整个 `createTray()` 包 try/catch，失败打中文错误日志并降级（程序仍可用）。
4. **模板图必须纯黑 + alpha**：彩色图当 macOS 模板图会渲染成色块；文件名不加 `Template` 则失去亮暗自适应。
5. **dev/打包路径分流**：dev 下 `__dirname` 是 `electron/dist`，资源在仓库根 `resources/`（`../../resources/tray`）；打包后经 `process.resourcesPath`。漏分支会在打包产物上静默丢图标。
6. **验证边界**：状态栏图标点击无法脚本模拟（需辅助功能权限）。实证手段 = 启动日志（"系统驻留图标已创建"/中文错误）+ 原生窗口截图（`screencapture -x -o -l <窗口ID>`，窗口 ID 用 Quartz `CGWindowListCopyWindowInfo` 按 Owner 过滤取得）+ 菜单栏条带截图确认图标出现。交互手感由人工点验。
