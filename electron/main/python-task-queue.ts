import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'

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
  constructor(
    readonly kind: PythonEnvironmentErrorKind,
    installCommands = 'python3 -m pip install requests'
  ) {
    super(
      kind === 'python-missing'
        ? '未检测到 Python 3，无法获取财务数据。请先安装 Python 3，安装完成后重新获取。'
        : `已检测到 Python 3，但缺少 requests 依赖。请在终端执行以下命令，完成后重新获取：\n${installCommands}`
    )
  }
}

export class PythonTaskQueue {
  private tail: Promise<void> = Promise.resolve()
  private lastEnvironmentMessage = ''

  constructor(
    private readonly notifyEnvironmentError: (message: string) => void,
    private readonly environmentDirectory?: string
  ) {}

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
    const candidates: PythonRuntime[] = []
    if (this.environmentDirectory) {
      candidates.push({ command: this.environmentPython(), prefixArgs: [] })
    }
    if (process.platform === 'win32') candidates.push({ command: 'py', prefixArgs: ['-3'] })
    candidates.push({ command: 'python3', prefixArgs: [] }, { command: 'python', prefixArgs: [] })
    if (process.platform === 'darwin') {
      // Finder 启动的应用不一定继承终端中的 Homebrew / Python.org PATH。
      for (const command of [
        '/opt/homebrew/bin/python3',
        '/usr/local/bin/python3',
        '/Library/Frameworks/Python.framework/Versions/Current/bin/python3',
        '/usr/bin/python3'
      ]) {
        candidates.push({ command, prefixArgs: [] })
      }
    }
    let pythonFound: PythonRuntime | undefined
    for (const candidate of candidates) {
      const result = await this.probe(candidate)
      if (result.available) pythonFound ??= candidate
      if (result.requestsAvailable) return candidate
    }
    if (pythonFound) {
      throw new PythonEnvironmentError('requests-missing', this.installCommands(pythonFound))
    }
    throw new PythonEnvironmentError('python-missing')
  }

  private environmentPython(): string {
    return join(
      this.environmentDirectory!,
      process.platform === 'win32' ? 'Scripts' : 'bin',
      process.platform === 'win32' ? 'python.exe' : 'python3'
    )
  }

  private installCommands(runtime: PythonRuntime): string {
    const format = (command: string, args: string[]): string =>
      [command, ...args]
        .map((arg) => {
          if (/^[\w./:\\-]+$/.test(arg)) return arg
          return process.platform === 'win32'
            ? `"${arg.replace(/"/g, '""')}"`
            : `'${arg.replace(/'/g, "'\\''")}'`
        })
        .join(' ')

    if (!this.environmentDirectory) {
      return format(runtime.command, [...runtime.prefixArgs, '-m', 'pip', 'install', 'requests'])
    }
    const python = this.environmentPython()
    const install = format(python, ['-m', 'pip', 'install', 'requests'])
    if (runtime.command === python) return install
    return `${format(runtime.command, [...runtime.prefixArgs, '-m', 'venv', this.environmentDirectory])}\n${install}`
  }

  private probe(runtime: PythonRuntime): Promise<ProbeResult> {
    return new Promise((resolve) => {
      const child = spawn(
        runtime.command,
        [
          ...runtime.prefixArgs,
          '-c',
          'import sys\nif sys.version_info[0] != 3:\n sys.exit(2)\ntry:\n import requests\nexcept Exception:\n sys.exit(3)'
        ],
        { windowsHide: true }
      )
      let settled = false
      child.on('error', () => {
        if (settled) return
        settled = true
        resolve({ available: false, requestsAvailable: false })
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        resolve({ available: code === 0 || code === 3, requestsAvailable: code === 0 })
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
