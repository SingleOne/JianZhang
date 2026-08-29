import { spawn } from 'node:child_process'
import { dirname } from 'node:path'

type PythonEnvironmentErrorKind = 'python-missing' | 'requests-missing'

interface PythonRuntime {
  command: string
  prefixArgs: string[]
}

interface ProbeResult {
  available: boolean
  requestsAvailable: boolean
}

export class PythonEnvironmentError extends Error {
  constructor(readonly kind: PythonEnvironmentErrorKind) {
    super(
      kind === 'python-missing'
        ? '未检测到 Python 3，无法获取财务数据。请先安装 Python 3，安装完成后重新获取。'
        : '已检测到 Python 3，但缺少 requests 依赖。请执行：python -m pip install requests'
    )
  }
}

export class PythonTaskQueue {
  private tail: Promise<void> = Promise.resolve()
  private lastEnvironmentMessage = ''

  constructor(private readonly notifyEnvironmentError: (message: string) => void) {}

  run(
    scriptPath: string,
    args: string[],
    onOutput: (content: string) => void,
    onStart: () => void
  ): Promise<void> {
    const task = this.tail.then(async () => {
      onStart()
      let runtime: PythonRuntime
      try {
        runtime = await this.findRuntime()
        this.lastEnvironmentMessage = ''
      } catch (reason) {
        if (
          reason instanceof PythonEnvironmentError &&
          reason.message !== this.lastEnvironmentMessage
        ) {
          this.lastEnvironmentMessage = reason.message
          this.notifyEnvironmentError(reason.message)
        }
        throw reason
      }
      await this.spawnProcess(
        runtime.command,
        [...runtime.prefixArgs, scriptPath, ...args],
        dirname(scriptPath),
        onOutput
      )
    })
    this.tail = task.then(
      () => undefined,
      () => undefined
    )
    return task
  }

  private async findRuntime(): Promise<PythonRuntime> {
    const candidates: PythonRuntime[] = [
      { command: 'py', prefixArgs: ['-3'] },
      { command: 'python', prefixArgs: [] }
    ]
    let pythonFound = false
    for (const candidate of candidates) {
      const result = await this.probe(candidate)
      pythonFound ||= result.available
      if (result.requestsAvailable) return candidate
    }
    throw new PythonEnvironmentError(pythonFound ? 'requests-missing' : 'python-missing')
  }

  private probe(runtime: PythonRuntime): Promise<ProbeResult> {
    return new Promise((resolve) => {
      const child = spawn(runtime.command, [...runtime.prefixArgs, '-c', 'import requests'], {
        windowsHide: true
      })
      let settled = false
      child.on('error', (reason: NodeJS.ErrnoException) => {
        if (settled) return
        settled = true
        if (reason.code === 'ENOENT') resolve({ available: false, requestsAvailable: false })
        else resolve({ available: true, requestsAvailable: false })
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        resolve({ available: true, requestsAvailable: code === 0 })
      })
    })
  }

  private spawnProcess(
    command: string,
    args: string[],
    cwd: string,
    onOutput: (content: string) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1'
        }
      })
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => onOutput(chunk.toString('utf8')))
      child.stderr.on('data', (chunk: Buffer) => {
        const content = chunk.toString('utf8')
        stderr += content
        onOutput(content)
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(stderr.trim() || `Python 更新脚本退出，代码 ${code}`))
      })
    })
  }
}
