/**
 * 智能主机本机信息桥：渲染侧设备接入握手所需的本机凭据。
 * 握手令牌 = daemon 的 daemonTokenPath（与 daemon 侧同构：优先
 * ~/.mindx/data/daemon_token（运行期 dataDir），回落 ~/.mindx/daemon_token；
 * 局域网其他设备读不到该文件，这是「本机直通」的信任根）。
 * 主机名用于在对方设备的接入请求里显示可辨识的设备名。
 * 安全：只读不写；令牌仅回发给本应用的渲染进程（BrowserWindow 校验同范式）。
 */
import { BrowserWindow, ipcMain } from 'electron'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 渲染侧消费的本机信息（token 缺失/读取失败为 null，由渲染侧提示） */
export interface HostInfo {
  token: string | null
  hostname: string
}

function readDaemonToken(): string | null {
  const base = path.join(os.homedir(), '.mindx')
  for (const rel of ['data/daemon_token', 'daemon_token']) {
    try {
      const raw = readFileSync(path.join(base, ...rel.split('/')), 'utf8').trim()
      if (raw) return raw
    } catch {
      // 该路径不存在/不可读，尝试下一候选
    }
  }
  return null
}

/** 注册本机信息 IPC（渲染侧经 preload 桥调用） */
export function registerHostInfoBridge(): void {
  ipcMain.handle('mx:host-info', (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return null
    const info: HostInfo = { token: readDaemonToken(), hostname: os.hostname() }
    return info
  })
}
