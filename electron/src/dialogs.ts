/**
 * 系统文件对话框桥（主进程）：为渲染侧提供"保存文件 / 选择分发包"两个原生对话框。
 * 机械层不做业务校验，只保证对话框挂父窗口（模态归属正确）与入参类型合法。
 */
import { BrowserWindow, dialog, ipcMain } from 'electron'

/** IPC 注册：全部要求窗口内发起（契约 §17 边界校验） */
export function registerDialogBridge(): void {
  // 保存文件：defaultName 为缺省文件名（如 xxx.mindpkg）；取消返回 null
  ipcMain.handle('mx:dialog-save-file', async (event, defaultName: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || typeof defaultName !== 'string') return null
    const picked = await dialog.showSaveDialog(win, {
      title: '保存文件',
      defaultPath: defaultName,
      properties: ['createDirectory'],
    })
    return picked.canceled || !picked.filePath ? null : picked.filePath
  })
  // 选择技能分发包（.mindpkg）；取消返回 null
  ipcMain.handle('mx:dialog-open-mindpkg', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const picked = await dialog.showOpenDialog(win, {
      title: '选择技能分发包',
      filters: [{ name: '技能分发包', extensions: ['mindpkg'] }],
      properties: ['openFile'],
    })
    return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0]
  })
}
