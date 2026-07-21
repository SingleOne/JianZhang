import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'

interface RpcError {
  code: number
  message: string
}

interface RpcMessage {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: RpcError
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timeout: NodeJS.Timeout
}

type NotificationListener = (method: string, params: unknown) => void
type FailureListener = (error: Error) => void

const CODEX_EXECUTABLE_RELATIVE_PATH = join(
  'node_modules',
  '@openai',
  'codex-win32-x64',
  'vendor',
  'x86_64-pc-windows-msvc',
  'bin',
  'codex.exe'
)

export function findCodexExecutable(): string | null {
  const candidates = [
    join(process.resourcesPath, 'codex-runtime', 'bin', 'codex.exe'),
    join(process.cwd(), CODEX_EXECUTABLE_RELATIVE_PATH)
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export class CodexAppServer {
  private process: ChildProcessWithoutNullStreams | null = null
  private startPromise: Promise<void> | null = null
  private requestId = 0
  private stderrTail = ''
  private readonly pending = new Map<number, PendingRequest>()
  private readonly notificationListeners = new Set<NotificationListener>()
  private readonly failureListeners = new Set<FailureListener>()
  readonly workspaceDirectory: string
  private readonly codexHomeDirectory: string

  constructor(private readonly rootDirectory: string, private readonly clientVersion: string) {
    this.workspaceDirectory = join(rootDirectory, 'codex-workspace')
    this.codexHomeDirectory = join(rootDirectory, 'codex-runtime')
    mkdirSync(this.workspaceDirectory, { recursive: true })
    mkdirSync(this.codexHomeDirectory, { recursive: true })
  }

  isAvailable(): boolean {
    return findCodexExecutable() !== null
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    await this.ensureStarted()
    return this.requestRaw<T>(method, params)
  }

  notify(method: string, params?: unknown): void {
    this.write({ method, params: params ?? {} })
  }

  onNotification(listener: NotificationListener): () => void {
    this.notificationListeners.add(listener)
    return () => this.notificationListeners.delete(listener)
  }

  waitForNotification<T>(
    method: string,
    predicate: (params: T) => boolean,
    timeoutMs = 10 * 60 * 1000
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const finish = (callback: () => void) => {
        clearTimeout(timeout)
        removeNotification()
        removeFailure()
        callback()
      }
      const removeNotification = this.onNotification((nextMethod, params) => {
        if (nextMethod === method && predicate(params as T)) finish(() => resolve(params as T))
      })
      const failureListener: FailureListener = (error) => finish(() => reject(error))
      this.failureListeners.add(failureListener)
      const removeFailure = () => this.failureListeners.delete(failureListener)
      const timeout = setTimeout(() => finish(() => reject(new Error('Codex 运行时等待响应超时'))), timeoutMs)
    })
  }

  dispose(): void {
    const child = this.process
    this.process = null
    this.startPromise = null
    if (child && !child.killed) child.kill()
    this.rejectPending(new Error('Codex 运行时已关闭'))
  }

  private ensureStarted(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = this.start().catch((error) => {
      this.startPromise = null
      throw error
    })
    return this.startPromise
  }

  private async start(): Promise<void> {
    const executable = findCodexExecutable()
    if (!executable) throw new Error('未找到随应用安装的 Codex 官方运行时')
    this.stderrTail = ''
    const child = spawn(executable, ['app-server'], {
      cwd: this.workspaceDirectory,
      env: { ...process.env, CODEX_HOME: this.codexHomeDirectory },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.process = child
    createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(line))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-1000)
    })
    child.once('error', (error) => this.fail(error))
    child.once('exit', (code) => {
      if (this.process !== child) return
      const detail = this.stderrTail.trim()
      this.fail(new Error(detail || `Codex 运行时已退出（${code ?? 'unknown'}）`))
    })
    await this.requestRaw('initialize', {
      clientInfo: {
        name: 'jianzhang_stock_desktop',
        title: '见涨',
        version: this.clientVersion
      }
    })
    this.notify('initialized')
  }

  private requestRaw<T>(method: string, params?: unknown): Promise<T> {
    const id = ++this.requestId
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex 运行时请求超时：${method}`))
      }, 30_000)
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout
      })
      this.write({ id, method, params: params ?? {} })
    })
  }

  private write(message: RpcMessage): void {
    if (!this.process || this.process.killed) throw new Error('Codex 运行时尚未启动')
    this.process.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private handleLine(line: string): void {
    let message: RpcMessage
    try {
      message = JSON.parse(line) as RpcMessage
    } catch {
      return
    }
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
      return
    }
    if (message.method && message.id === undefined) {
      for (const listener of this.notificationListeners) listener(message.method, message.params)
      return
    }
    if (message.method && message.id !== undefined) {
      this.write({ id: message.id, error: { code: -32601, message: '见涨不提供 Codex 工具调用能力' } })
    }
  }

  private fail(error: Error): void {
    this.process = null
    this.startPromise = null
    this.rejectPending(error)
    for (const listener of this.failureListeners) listener(error)
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout)
      request.reject(error)
    }
    this.pending.clear()
  }
}
