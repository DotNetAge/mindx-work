/**
 * 系统文件对话框桥（主进程）：为渲染侧提供"保存文件 / 选择分发包"两个原生对话框。
 * 机械层不做业务校验，只保证对话框挂父窗口（模态归属正确）与入参类型合法。
 */
import { basename } from 'node:path'
import { readFile } from 'node:fs/promises'
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
  // 选择图片（市场头像上传，PNG/JPEG）；返回 base64 内容 + 文件名，取消返回 null。
  // 内容在主进程读取（渲染进程不持文件路径读权），≤1MB 上限在此硬顶防巨型 IPC 载荷
  ipcMain.handle('mx:dialog-open-image', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const picked = await dialog.showOpenDialog(win, {
      title: '选择头像图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg'] }],
      properties: ['openFile'],
    })
    if (picked.canceled || picked.filePaths.length === 0) return null
    const path = picked.filePaths[0]
    const data = await readFile(path)
    if (data.byteLength > 1024 * 1024) return { error: '图片需小于 1MB' }
    return { data_base64: data.toString('base64'), filename: basename(path) }
  })
}
