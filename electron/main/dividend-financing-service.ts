import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import builtInSnapshot from '../../src/data/dividend-financing-ranking.json'
import {
  createDividendFinancingChangeReport,
  parseDividendFinancingSnapshot,
  selectDividendFinancingSnapshot
} from '../../src/lib/dividend-financing'
import type {
  DividendFinancingChangeReport,
  DividendFinancingSnapshot,
  DividendFinancingUpdateProgress,
  DividendFinancingUpdateResult
} from '../../src/shared/types'

class PythonCommandNotFoundError extends Error {}

export class DividendFinancingService {
  private readonly dataDirectory: string
  private readonly snapshotPath: string
  private readonly reportPath: string
  private readonly diagnosticsPath: string
  private readonly previousSnapshotPath: string
  private readonly changeReportPath: string
  // 快照更新频率很低；进程内复用同一对象，打开榜单不会重复读盘或解析 JSON。
  private snapshotCache: DividendFinancingSnapshot | null = null
  private changeReportCache: DividendFinancingChangeReport | null | undefined
  private updating = false

  constructor(
    userDataDirectory: string,
    private readonly notifyProgress: (progress: DividendFinancingUpdateProgress) => void
  ) {
    this.dataDirectory = join(userDataDirectory, 'dividend-financing')
    this.snapshotPath = join(this.dataDirectory, 'ranking.json')
    this.reportPath = join(this.dataDirectory, 'report.md')
    this.diagnosticsPath = join(this.dataDirectory, 'diagnostics.json')
    this.previousSnapshotPath = join(this.dataDirectory, 'previous-ranking.json')
    this.changeReportPath = join(this.dataDirectory, 'change-report.json')
  }

  getSnapshot(): DividendFinancingSnapshot {
    if (this.snapshotCache) return this.snapshotCache
    const bundled = builtInSnapshot as DividendFinancingSnapshot
    if (existsSync(this.snapshotPath)) {
      try {
        this.snapshotCache = selectDividendFinancingSnapshot(
          bundled,
          parseDividendFinancingSnapshot(readFileSync(this.snapshotPath, 'utf8'))
        )
        return this.snapshotCache
      } catch {
        // Keep the bundled snapshot available if a previous manual update was interrupted.
      }
    }
    this.snapshotCache = bundled
    return this.snapshotCache
  }

  getChangeReport(): DividendFinancingChangeReport | null {
    if (this.changeReportCache !== undefined) return this.changeReportCache
    if (!existsSync(this.changeReportPath)) {
      this.changeReportCache = null
      return null
    }
    try {
      const report = JSON.parse(readFileSync(this.changeReportPath, 'utf8')) as DividendFinancingChangeReport
      this.changeReportCache = report.schemaVersion === 1 && Array.isArray(report.rows) ? report : null
      return this.changeReportCache
    } catch {
      this.changeReportCache = null
      return null
    }
  }

  async runUpdate(): Promise<DividendFinancingUpdateResult> {
    if (this.updating) throw new Error('分红融资榜更新脚本正在运行')
    this.updating = true
    mkdirSync(this.dataDirectory, { recursive: true })
    const previousSnapshot = this.getSnapshot()
    this.notifyProgress({ stage: 'running', message: '正在启动 Python 更新脚本…' })

    try {
      const scriptPath = app.isPackaged
        ? join(process.resourcesPath, 'scripts', 'generate_dividend_financing_report.py')
        : join(app.getAppPath(), 'scripts', 'generate_dividend_financing_report.py')
      const scriptArguments = [
        scriptPath,
        '--output',
        this.reportPath,
        '--json-output',
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

      const snapshot = parseDividendFinancingSnapshot(readFileSync(this.snapshotPath, 'utf8'))
      const changeReport = createDividendFinancingChangeReport(previousSnapshot, snapshot)
      writeFileSync(this.previousSnapshotPath, JSON.stringify(previousSnapshot, null, 2), 'utf8')
      writeFileSync(this.changeReportPath, JSON.stringify(changeReport, null, 2), 'utf8')
      this.snapshotCache = snapshot
      this.changeReportCache = changeReport
      this.notifyProgress({
        stage: 'completed',
        message: `更新完成：${snapshot.snapshotDate}，共 ${snapshot.rows.length} 只股票`
      })
      return {
        snapshot,
        changeReport,
        reportPath: this.reportPath,
        diagnosticsPath: this.diagnosticsPath
      }
    } catch (reason) {
      const message =
        reason instanceof PythonCommandNotFoundError
          ? '未找到 Python 3，请先安装 Python 3 和 requests。'
          : reason instanceof Error
            ? reason.message
            : '分红融资榜更新失败'
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
