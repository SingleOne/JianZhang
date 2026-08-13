import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fundamentalStaleReason } from '../../src/lib/data-snapshot-status'
import { createFundamentalChangeReport } from '../../src/lib/fundamental-screening'
import { parseFundamentalSnapshot } from '../../src/lib/fundamentals'
import type {
  DataSnapshotRuntimeState,
  FundamentalChangeReport,
  FundamentalSnapshot,
  FundamentalUpdateProgress,
  FundamentalUpdateResult
} from '../../src/shared/types'
import type { PythonTaskQueue } from './python-task-queue'

const EMPTY_STATE: DataSnapshotRuntimeState = {
  status: 'missing',
  progressMessage: '尚无基本面财务数据，正在等待首次获取。',
  error: null,
  snapshotDate: null,
  generatedAt: null,
  recordCount: 0,
  periodLabel: null,
  staleReason: null
}

export class FundamentalDataService {
  private readonly dataDirectory: string
  private readonly snapshotPath: string
  private readonly diagnosticsPath: string
  private readonly changeReportPath: string
  private snapshotCache: FundamentalSnapshot | null = null
  private changeReportCache: FundamentalChangeReport | null | undefined
  private runtimeState: DataSnapshotRuntimeState = EMPTY_STATE
  private updating = false
  private initialization: Promise<void> | null = null
  private initialized = false

  constructor(
    userDataDirectory: string,
    private readonly pythonQueue: PythonTaskQueue,
    private readonly notifyProgress: (progress: FundamentalUpdateProgress) => void,
    private readonly notifyState: (state: DataSnapshotRuntimeState) => void
  ) {
    this.dataDirectory = join(userDataDirectory, 'fundamentals')
    this.snapshotPath = join(this.dataDirectory, 'snapshot.json')
    this.diagnosticsPath = join(this.dataDirectory, 'diagnostics.json')
    this.changeReportPath = join(this.dataDirectory, 'change-report.json')
    if (existsSync(this.snapshotPath)) {
      this.runtimeState = {
        ...EMPTY_STATE,
        status: 'queued',
        progressMessage: '正在加载本地基本面财务数据。'
      }
    }
  }

  getSnapshot(): FundamentalSnapshot | null {
    return this.snapshotCache
  }

  getState(): DataSnapshotRuntimeState {
    return { ...this.runtimeState }
  }

  getChangeReport(): FundamentalChangeReport | null {
    if (!this.snapshotCache) return null
    if (this.changeReportCache !== undefined) return this.changeReportCache
    if (!existsSync(this.changeReportPath)) {
      this.changeReportCache = null
      return null
    }
    try {
      const report = JSON.parse(
        readFileSync(this.changeReportPath, 'utf8')
      ) as FundamentalChangeReport
      this.changeReportCache =
        report.schemaVersion === 1 && Array.isArray(report.rows) ? report : null
      return this.changeReportCache
    } catch {
      this.changeReportCache = null
      return null
    }
  }

  initializeIfMissing(): void {
    if (!this.initialization) this.initialization = this.loadSnapshot().catch(() => undefined)
    if (this.initialized) return
    this.initialized = true
    void this.initialization.then(() => {
      if (this.runtimeState.status === 'missing') void this.runUpdate().catch(() => undefined)
    })
  }

  async runUpdate(): Promise<FundamentalUpdateResult> {
    if (this.initialization) await this.initialization
    if (this.updating) throw new Error('基本面财务数据更新脚本正在运行')
    this.updating = true
    mkdirSync(this.dataDirectory, { recursive: true })
    const previousSnapshot = this.snapshotCache
    const nextSnapshotPath = join(this.dataDirectory, 'snapshot.next.json')
    const nextDiagnosticsPath = join(this.dataDirectory, 'diagnostics.next.json')
    const nextChangeReportPath = join(this.dataDirectory, 'change-report.next.json')
    this.setState({
      ...this.snapshotState(previousSnapshot),
      status: 'queued',
      progressMessage: '基本面财务数据更新已加入队列。',
      error: null
    })

    try {
      const scriptPath = app.isPackaged
        ? join(process.resourcesPath, 'scripts', 'generate_fundamental_snapshot.py')
        : join(app.getAppPath(), 'scripts', 'generate_fundamental_snapshot.py')
      await this.pythonQueue.run(
        scriptPath,
        ['--output', nextSnapshotPath, '--diagnostics', nextDiagnosticsPath],
        (content) => this.reportOutput(content),
        () => {
          this.setState({
            ...this.snapshotState(previousSnapshot),
            status: 'updating',
            progressMessage: '正在运行基本面财务数据更新脚本…',
            error: null
          })
          this.notifyProgress({
            stage: 'running',
            message: '正在运行基本面财务数据更新脚本…'
          })
        }
      )

      const snapshot = parseFundamentalSnapshot(readFileSync(nextSnapshotPath, 'utf8'))
      const changeReport = previousSnapshot
        ? createFundamentalChangeReport(previousSnapshot, snapshot)
        : null
      if (changeReport) {
        writeFileSync(nextChangeReportPath, JSON.stringify(changeReport, null, 2), 'utf8')
        renameSync(nextChangeReportPath, this.changeReportPath)
      } else if (existsSync(this.changeReportPath)) {
        unlinkSync(this.changeReportPath)
      }
      renameSync(nextDiagnosticsPath, this.diagnosticsPath)
      renameSync(nextSnapshotPath, this.snapshotPath)
      this.snapshotCache = snapshot
      this.changeReportCache = changeReport
      this.setState(this.snapshotState(snapshot))
      this.notifyProgress({
        stage: 'completed',
        message: `基本面数据更新完成：${snapshot.rows.length} 家公司，${snapshot.fiscalYears[0]}—${snapshot.fiscalYears.at(-1)} 年`
      })
      return {
        snapshot,
        changeReport,
        snapshotPath: this.snapshotPath,
        diagnosticsPath: this.diagnosticsPath
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '基本面财务数据更新失败'
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

  private async loadSnapshot(): Promise<void> {
    if (!existsSync(this.snapshotPath)) return
    try {
      this.snapshotCache = parseFundamentalSnapshot(await readFile(this.snapshotPath, 'utf8'))
      this.setState(this.snapshotState(this.snapshotCache))
    } catch (reason) {
      this.setState({
        ...EMPTY_STATE,
        error: reason instanceof Error ? reason.message : '基本面财务快照无法读取'
      })
    }
  }

  private snapshotState(snapshot: FundamentalSnapshot | null): DataSnapshotRuntimeState {
    if (!snapshot) return { ...EMPTY_STATE }
    const staleReason = fundamentalStaleReason(snapshot)
    return {
      status: staleReason ? 'stale' : 'ready',
      progressMessage: null,
      error: null,
      snapshotDate: snapshot.snapshotDate,
      generatedAt: snapshot.generatedAt,
      recordCount: snapshot.rows.length,
      periodLabel: `${snapshot.fiscalYears[0]}—${snapshot.fiscalYears.at(-1)} 年`,
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
