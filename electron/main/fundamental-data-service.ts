import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import builtInSnapshot from '../../src/data/fundamental-snapshot.json'
import { parseFundamentalSnapshot, selectFundamentalSnapshot } from '../../src/lib/fundamentals'
import type {
  FundamentalSnapshot,
  FundamentalUpdateProgress,
  FundamentalUpdateResult
} from '../../src/shared/types'

class PythonCommandNotFoundError extends Error {}

export class FundamentalDataService {
  private readonly dataDirectory: string
  private readonly snapshotPath: string
  private readonly diagnosticsPath: string
  private snapshotCache: FundamentalSnapshot | null = null
  private updating = false

  constructor(
    userDataDirectory: string,
    private readonly notifyProgress: (progress: FundamentalUpdateProgress) => void
  ) {
    this.dataDirectory = join(userDataDirectory, 'fundamentals')
    this.snapshotPath = join(this.dataDirectory, 'snapshot.json')
    this.diagnosticsPath = join(this.dataDirectory, 'diagnostics.json')
  }

  getSnapshot(): FundamentalSnapshot {
    if (this.snapshotCache) return this.snapshotCache
    const bundled = builtInSnapshot as FundamentalSnapshot
    if (existsSync(this.snapshotPath)) {
      try {
        this.snapshotCache = selectFundamentalSnapshot(
          bundled,
          parseFundamentalSnapshot(readFileSync(this.snapshotPath, 'utf8'))
        )
        return this.snapshotCache
      } catch {
        // A bundled snapshot remains available after an interrupted manual update.
      }
    }
    this.snapshotCache = bundled
    return this.snapshotCache
  }

  async runUpdate(): Promise<FundamentalUpdateResult> {
    if (this.updating) throw new Error('基本面财务数据更新脚本正在运行')
    this.updating = true
    mkdirSync(this.dataDirectory, { recursive: true })
    this.notifyProgress({ stage: 'running', message: '正在启动基本面财务数据更新脚本…' })

    try {
      const scriptPath = app.isPackaged
        ? join(process.resourcesPath, 'scripts', 'generate_fundamental_snapshot.py')
        : join(app.getAppPath(), 'scripts', 'generate_fundamental_snapshot.py')
      const scriptArguments = [
        scriptPath,
        '--output',
        this.snapshotPath,
        '--diagnostics',
        this.diagnosticsPath
      ]
      try {
        await this.runPython('py', ['-3', ...scriptArguments])
      } catch (reason) {
        if (!(reason instanceof PythonCommandNotFoundError)) throw reason
        await this.runPython('python', scriptArguments)
      }

      const snapshot = parseFundamentalSnapshot(readFileSync(this.snapshotPath, 'utf8'))
      this.snapshotCache = snapshot
      this.notifyProgress({
        stage: 'completed',
        message: `基本面数据更新完成：${snapshot.rows.length} 家公司，${snapshot.fiscalYears[0]}—${snapshot.fiscalYears.at(-1)} 年`
      })
      return { snapshot, snapshotPath: this.snapshotPath, diagnosticsPath: this.diagnosticsPath }
    } catch (reason) {
      const message =
        reason instanceof PythonCommandNotFoundError
          ? '未找到 Python 3，请先安装 Python 3 和 requests。'
          : reason instanceof Error
            ? reason.message
            : '基本面财务数据更新失败'
      this.notifyProgress({ stage: 'failed', message })
      throw new Error(message)
    } finally {
      this.updating = false
    }
  }

  private runPython(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: dirname(args.includes('-3') ? args[1] : args[0]),
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1'
        }
      })
      let stderr = ''
      let settled = false
      const reportOutput = (content: string) => {
        const line = content.trim().split(/\r?\n/).at(-1)
        if (line) this.notifyProgress({ stage: 'running', message: line })
      }
      child.stdout.on('data', (chunk: Buffer) => reportOutput(chunk.toString('utf8')))
      child.stderr.on('data', (chunk: Buffer) => {
        const content = chunk.toString('utf8')
        stderr += content
        reportOutput(content)
      })
      child.on('error', (reason: NodeJS.ErrnoException) => {
        if (settled) return
        settled = true
        if (reason.code === 'ENOENT') reject(new PythonCommandNotFoundError())
        else reject(reason)
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        if (code === 0) resolve()
        else reject(new Error(stderr.trim() || `Python 更新脚本退出，代码 ${code}`))
      })
    })
  }
}
