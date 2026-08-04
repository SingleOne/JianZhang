import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { dividendFinancingStaleReason } from '../../src/lib/data-snapshot-status'
import {
  createDividendFinancingChangeReport,
  parseDividendFinancingSnapshot
} from '../../src/lib/dividend-financing'
import type {
  DataSnapshotRuntimeState,
  DividendFinancingChangeReport,
  DividendFinancingSnapshot,
  DividendFinancingUpdateProgress,
  DividendFinancingUpdateResult
} from '../../src/shared/types'
import type { PythonTaskQueue } from './python-task-queue'

const EMPTY_STATE: DataSnapshotRuntimeState = {
  status: 'missing',
  progressMessage: '尚无分红融资榜数据，正在等待首次获取。',
  error: null,
  snapshotDate: null,
  generatedAt: null,
  recordCount: 0,
  periodLabel: null,
  staleReason: null
}

export class DividendFinancingService {
  private readonly dataDirectory: string
  private readonly snapshotPath: string
  private readonly reportPath: string
  private readonly diagnosticsPath: string
  private readonly previousSnapshotPath: string
  private readonly changeReportPath: string
  private snapshotCache: DividendFinancingSnapshot | null = null
  private changeReportCache: DividendFinancingChangeReport | null | undefined
  private runtimeState: DataSnapshotRuntimeState = EMPTY_STATE
  private updating = false

  constructor(
    userDataDirectory: string,
    private readonly pythonQueue: PythonTaskQueue,
    private readonly notifyProgress: (progress: DividendFinancingUpdateProgress) => void,
    private readonly notifyState: (state: DataSnapshotRuntimeState) => void
  ) {
    this.dataDirectory = join(userDataDirectory, 'dividend-financing')
    this.snapshotPath = join(this.dataDirectory, 'ranking.json')
    this.reportPath = join(this.dataDirectory, 'report.md')
    this.diagnosticsPath = join(this.dataDirectory, 'diagnostics.json')
    this.previousSnapshotPath = join(this.dataDirectory, 'previous-ranking.json')
    this.changeReportPath = join(this.dataDirectory, 'change-report.json')
    this.loadSnapshot()
  }

  getSnapshot(): DividendFinancingSnapshot | null {
    return this.snapshotCache
  }

  getState(): DataSnapshotRuntimeState {
    return { ...this.runtimeState }
  }

  getChangeReport(): DividendFinancingChangeReport | null {
    if (!this.snapshotCache) return null
    if (this.changeReportCache !== undefined) return this.changeReportCache
    if (!existsSync(this.changeReportPath)) {
      this.changeReportCache = null
      return null
    }
    try {
      const report = JSON.parse(
        readFileSync(this.changeReportPath, 'utf8')
      ) as DividendFinancingChangeReport
      this.changeReportCache = report.schemaVersion === 1 && Array.isArray(report.rows)
        ? report
        : null
      return this.changeReportCache
    } catch {
      this.changeReportCache = null
      return null
    }
  }

  initializeIfMissing(): void {
    if (this.runtimeState.status === 'missing') void this.runUpdate().catch(() => undefined)
  }

  async runUpdate(): Promise<DividendFinancingUpdateResult> {
    if (this.updating) throw new Error('分红融资榜更新脚本正在运行')
    this.updating = true
    mkdirSync(this.dataDirectory, { recursive: true })
    const previousSnapshot = this.snapshotCache
    const nextSnapshotPath = join(this.dataDirectory, 'ranking.next.json')
    const nextReportPath = join(this.dataDirectory, 'report.next.md')
    const nextDiagnosticsPath = join(this.dataDirectory, 'diagnostics.next.json')
    const nextChangeReportPath = join(this.dataDirectory, 'change-report.next.json')
    this.setState({
      ...this.snapshotState(previousSnapshot),
      status: 'queued',
      progressMessage: '分红融资榜更新已加入队列。',
      error: null
    })

    try {
      const scriptPath = app.isPackaged
        ? join(process.resourcesPath, 'scripts', 'generate_dividend_financing_report.py')
        : join(app.getAppPath(), 'scripts', 'generate_dividend_financing_report.py')
      await this.pythonQueue.run(
        scriptPath,
        [
          '--output',
          nextReportPath,
          '--json-output',
          nextSnapshotPath,
          '--diagnostics',
          nextDiagnosticsPath
        ],
        (content) => this.reportOutput(content),
        () => {
          this.setState({
            ...this.snapshotState(previousSnapshot),
            status: 'updating',
            progressMessage: '正在运行分红融资榜更新脚本…',
            error: null
          })
          this.notifyProgress({ stage: 'running', message: '正在运行分红融资榜更新脚本…' })
        }
      )

      const snapshot = parseDividendFinancingSnapshot(readFileSync(nextSnapshotPath, 'utf8'))
      const changeReport = previousSnapshot
        ? createDividendFinancingChangeReport(previousSnapshot, snapshot)
        : null
      if (previousSnapshot) {
        writeFileSync(
          this.previousSnapshotPath,
          JSON.stringify(previousSnapshot, null, 2),
          'utf8'
        )
      }
      if (changeReport) {
        writeFileSync(nextChangeReportPath, JSON.stringify(changeReport, null, 2), 'utf8')
        renameSync(nextChangeReportPath, this.changeReportPath)
      } else if (existsSync(this.changeReportPath)) {
        unlinkSync(this.changeReportPath)
      }
      renameSync(nextReportPath, this.reportPath)
      renameSync(nextDiagnosticsPath, this.diagnosticsPath)
      renameSync(nextSnapshotPath, this.snapshotPath)
      this.snapshotCache = snapshot
      this.changeReportCache = changeReport
      this.setState(this.snapshotState(snapshot))
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
      const message = reason instanceof Error ? reason.message : '分红融资榜更新失败'
      this.setState({
        ...this.snapshotState(this.snapshotCache),
        status: 'failed',
        progressMessage: null,
        error: message
      })
      this.notifyProgress({ stage: 'failed', message })
      throw new Error(message)
    } finally {
      this.updating = false
    }
  }

  private loadSnapshot(): void {
    if (!existsSync(this.snapshotPath)) return
    try {
      this.snapshotCache = parseDividendFinancingSnapshot(readFileSync(this.snapshotPath, 'utf8'))
      this.runtimeState = this.snapshotState(this.snapshotCache)
    } catch (reason) {
      this.runtimeState = {
        ...EMPTY_STATE,
        error: reason instanceof Error ? reason.message : '分红融资榜快照无法读取'
      }
    }
  }

  private snapshotState(snapshot: DividendFinancingSnapshot | null): DataSnapshotRuntimeState {
    if (!snapshot) return { ...EMPTY_STATE }
    const staleReason = dividendFinancingStaleReason(snapshot)
    return {
      status: staleReason ? 'stale' : 'ready',
      progressMessage: null,
      error: null,
      snapshotDate: snapshot.snapshotDate,
      generatedAt: snapshot.generatedAt,
      recordCount: snapshot.rows.length,
      periodLabel: `快照 ${snapshot.snapshotDate}`,
      staleReason
    }
  }

  private reportOutput(content: string): void {
    const line = content.trim().split(/\r?\n/).at(-1)
    if (!line) return
    this.notifyProgress({ stage: 'running', message: line })
    this.setState({ ...this.runtimeState, status: 'updating', progressMessage: line, error: null })
  }

  private setState(state: DataSnapshotRuntimeState): void {
    this.runtimeState = state
    this.notifyState({ ...state })
  }
}
