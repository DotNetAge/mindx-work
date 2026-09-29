/**
 * 终端会话桥（主进程）：pty 会话管理与 IPC 桥接（mx:terminal-*）。
 * 优先 @lydell/node-pty（node-pty 活跃维护 fork，带 prebuild；原版 1.1.0 在
 * 本机 macOS 上 posix_spawnp 全矩阵失败，已实证弃用），动态 require——
 * 加载失败时静默降级；降级方案 macOS 用 /usr/bin/script 伪造 pty
 * （child_process 管道），尺寸经首条 stty 命令同步（管道侧收不到 SIGWINCH，
 * 为降级已知限制）。会话按 id 登记、输出经 webContents.send 回推渲染侧
 * （xterm 呈现）；全部 handler 校验窗口内发起（契约 §17，对齐 dialogs.ts 范式）。
 */
import { BrowserWindow, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import os from 'node:os'

/** 终端会话统一形状（node-pty 与降级 spawn 各自适配） */
interface TerminalSession {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

/** node-pty 最小形状（本地声明，避免引入 @types/node-pty） */
interface PtyProcess {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(listener: (data: string) => void): void
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void
}

/** 登记项：会话本体 + 归属窗口（跨窗口操控一律拒绝） */
const sessions = new Map<string, { session: TerminalSession; senderId: number }>()
let nextId = 0

/** 尺寸边界（xterm fit 后传入，防异常值直传 pty） */
const COLS_MIN = 2
const COLS_MAX = 500
const ROWS_MIN = 2
const ROWS_MAX = 200

function createSession(
  cwd: string,
  cols: number,
  rows: number,
  onData: (data: string) => void,
  onExit: (exitCode: number) => void,
): TerminalSession {
  const shell = process.env.SHELL || '/bin/zsh'
  const env = { ...process.env, TERM: 'xterm-256color' }
  // 首选 @lydell/node-pty：真实 pty（resize 即时生效、TUI 应用完整可用）。
  // 动态 require 保证加载失败只影响本能力，不拖垮主进程启动
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pty = require('@lydell/node-pty') as {
      spawn(file: string, args: string[], options: object): PtyProcess
    }
    const proc = pty.spawn(shell, ['-l'], { name: 'xterm-256color', cols, rows, cwd, env })
    proc.onData(onData)
    proc.onExit((event) => onExit(event.exitCode))
    return {
      write: (data) => proc.write(data),
      resize: (c, r) => {
        try {
          proc.resize(c, r)
        } catch {
          // 退出竞态（对已退出的 pty resize 会抛）：静默忽略
        }
      },
      kill: () => {
        try {
          proc.kill()
        } catch {
          // 已退出：静默忽略
        }
      },
    }
  } catch {
    // 降级：script 伪造 pty（macOS）。首条 stty 同步初始尺寸——
    // 命令本身会在滚动区留一行回显，属降级方案已知限制；
    // 后续 resize 无法传导（SIGWINCH 不达），仅 node-pty 路径支持实时适配
    const proc = spawn('/usr/bin/script', ['-q', '/dev/null', shell, '-l'], { cwd, env })
    proc.stdout?.on('data', (chunk: Buffer) => onData(chunk.toString()))
    proc.stderr?.on('data', (chunk: Buffer) => onData(chunk.toString()))
    proc.on('exit', (code) => onExit(code ?? 0))
    proc.stdin?.write(`stty rows ${rows} cols ${cols}\n`)
    return {
      write: (data) => proc.stdin?.write(data),
      resize: () => {
        // 管道侧无尺寸信令，降级路径不支持实时 resize（见头注）
      },
      kill: () => {
        try {
          proc.kill()
        } catch {
          // 已退出：静默忽略
        }
      },
    }
  }
}

/** IPC 注册：create / write / resize / kill + 数据回推通道 */
export function registerTerminalBridge(): void {
  ipcMain.handle('mx:terminal-create', (event, cwd: unknown, cols: unknown, rows: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return null
    const dir = typeof cwd === 'string' && cwd ? cwd : os.homedir()
    const c = Number.isFinite(Number(cols)) ? Math.max(COLS_MIN, Math.min(COLS_MAX, Number(cols))) : 80
    const r = Number.isFinite(Number(rows)) ? Math.max(ROWS_MIN, Math.min(ROWS_MAX, Number(rows))) : 24
    const id = `term-${++nextId}`
    const sender = event.sender
    const session = createSession(
      dir,
      c,
      r,
      (data) => {
        if (!sender.isDestroyed()) sender.send('mx:terminal-data', { id, data })
      },
      () => {
        sessions.delete(id)
        if (!sender.isDestroyed()) sender.send('mx:terminal-exit', { id })
      },
    )
    sessions.set(id, { session, senderId: sender.id })
    // 窗口销毁时回收该窗口全部会话（once 重复注册幂等：命中后 Map 已清空）
    sender.once('destroyed', () => {
      for (const [key, entry] of sessions) {
        if (entry.senderId === sender.id) {
          entry.session.kill()
          sessions.delete(key)
        }
      }
    })
    return id
  })

  ipcMain.handle('mx:terminal-write', (event, id: unknown, data: unknown) => {
    if (typeof id !== 'string' || typeof data !== 'string') return false
    const entry = sessions.get(id)
    if (!entry || entry.senderId !== event.sender.id) return false
    entry.session.write(data)
    return true
  })

  ipcMain.handle('mx:terminal-resize', (event, id: unknown, cols: unknown, rows: unknown) => {
    if (typeof id !== 'string' || !Number.isFinite(Number(cols)) || !Number.isFinite(Number(rows))) return false
    const entry = sessions.get(id)
    if (!entry || entry.senderId !== event.sender.id) return false
    entry.session.resize(
      Math.max(COLS_MIN, Math.min(COLS_MAX, Number(cols))),
      Math.max(ROWS_MIN, Math.min(ROWS_MAX, Number(rows))),
    )
    return true
  })

  ipcMain.handle('mx:terminal-kill', (event, id: unknown) => {
    if (typeof id !== 'string') return false
    const entry = sessions.get(id)
    if (!entry || entry.senderId !== event.sender.id) return false
    entry.session.kill()
    sessions.delete(id)
    return true
  })
}
