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
  FundamentalOverview,
  FundamentalSnapshot,
  FundamentalUpdateProgress,
  FundamentalUpdateResult
} from '../../src/shared/types'
import { createFundamentalOverviewStore, type FundamentalOverviewMetadata } from './data-overview'
import { generateDataOverviewInWorker } from './data-overview-worker-client'
import type { IndexedOverviewManifest } from './indexed-overview-store'
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
  private readonly overviewStore: ReturnType<typeof createFundamentalOverviewStore>
  private overviewManifest: IndexedOverviewManifest<FundamentalOverviewMetadata> | null = null
  private snapshotCache: FundamentalSnapshot | null = null
  private changeReportCache: FundamentalChangeReport | null | undefined
  private runtimeState: DataSnapshotRuntimeState = EMPTY_STATE
  private updating = false
  private snapshotLoading: Promise<FundamentalSnapshot | null> | null = null
  private overviewGeneration: Promise<void> | null = null
  private overviewGenerationTimer: ReturnType<typeof setTimeout> | null = null
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
    this.overviewStore = createFundamentalOverviewStore(this.dataDirectory)
    this.overviewManifest = this.overviewStore.load(this.snapshotPath)
    if (this.overviewManifest) {
      this.runtimeState = this.snapshotState(this.overviewManifest.metadata)
    } else if (existsSync(this.snapshotPath)) {
      this.runtimeState = {
        ...EMPTY_STATE,
        status: 'queued',
        progressMessage: '正在准备基本面轻量概览。'
      }
    }
  }

  getOverview(codes: readonly string[]): FundamentalOverview | null {
    if (!this.overviewManifest) return null
    try {
      return {
        ...this.overviewManifest.metadata,
        rows: this.overviewStore.read(this.overviewManifest, codes)
      }
    } catch {
      this.overviewManifest = null
      this.setState({
        ...this.runtimeState,
        status: 'queued',
        progressMessage: '正在修复基本面轻量概览。'
      })
      void this.generateOverview(true).catch((reason) => {
        this.setState({
          ...this.runtimeState,
          status: 'failed',
          progressMessage: null,
          error: reason instanceof Error ? reason.message : '基本面轻量概览修复失败'
        })
      })
      return null
    }
  }

  async getSnapshot(): Promise<FundamentalSnapshot | null> {
    if (this.snapshotCache) return this.snapshotCache
    if (!existsSync(this.snapshotPath)) return null
    if (!this.snapshotLoading) {
      this.snapshotLoading = this.loadSnapshot().finally(() => {
        this.snapshotLoading = null
      })
    }
    return this.snapshotLoading
  }

  getState(): DataSnapshotRuntimeState {
    return { ...this.runtimeState }
  }

  getChangeReport(): FundamentalChangeReport | null {
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
    if (this.initialized) return
    this.initialized = true
    if (this.overviewManifest) return
    if (!existsSync(this.snapshotPath)) {
      void this.runUpdate().catch(() => undefined)
      return
    }
    this.overviewGenerationTimer = setTimeout(() => {
      this.overviewGenerationTimer = null
      void this.generateOverview().catch((reason) => {
        this.setState({
          ...EMPTY_STATE,
          status: 'failed',
          error: reason instanceof Error ? reason.message : '基本面轻量概览生成失败'
        })
      })
    }, 1_500)
    this.overviewGenerationTimer.unref()
  }

  async runUpdate(): Promise<FundamentalUpdateResult> {
    if (this.overviewGenerationTimer) clearTimeout(this.overviewGenerationTimer)
    this.overviewGenerationTimer = null
    if (this.overviewGeneration) await this.overviewGeneration
    if (this.updating) throw new Error('基本面财务数据更新脚本正在运行')
    this.updating = true
    mkdirSync(this.dataDirectory, { recursive: true })
    const previousSnapshot = await this.getSnapshot()
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
      await this.generateOverview()
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

  private async loadSnapshot(): Promise<FundamentalSnapshot | null> {
    try {
      this.snapshotCache = parseFundamentalSnapshot(await readFile(this.snapshotPath, 'utf8'))
      return this.snapshotCache
    } catch (reason) {
      this.setState({
        ...EMPTY_STATE,
        error: reason instanceof Error ? reason.message : '基本面财务快照无法读取'
      })
      return null
    }
  }

  private async generateOverview(force = false): Promise<void> {
    if (this.overviewGeneration) await this.overviewGeneration
    if (!force) {
      const existingManifest = this.overviewStore.load(this.snapshotPath)
      if (existingManifest) {
        this.overviewManifest = existingManifest
        this.setState(this.snapshotState(existingManifest.metadata))
        return
      }
    }

    this.overviewManifest = null
    const generation = generateDataOverviewInWorker(
      'fundamental',
      this.dataDirectory,
      this.snapshotPath
    )
    this.overviewGeneration = generation
    try {
      await generation
      this.overviewManifest = this.overviewStore.load(this.snapshotPath)
      if (!this.overviewManifest) throw new Error('基本面轻量概览无法读取')
      this.setState(this.snapshotState(this.overviewManifest.metadata))
    } finally {
      if (this.overviewGeneration === generation) this.overviewGeneration = null
    }
  }

  private snapshotState(
    snapshot: FundamentalSnapshot | FundamentalOverviewMetadata | null
  ): DataSnapshotRuntimeState {
    if (!snapshot) return { ...EMPTY_STATE }
    const staleReason = fundamentalStaleReason(
      'snapshotSchemaVersion' in snapshot
        ? { ...snapshot, schemaVersion: snapshot.snapshotSchemaVersion }
        : snapshot
    )
    return {
      status: staleReason ? 'stale' : 'ready',
      progressMessage: null,
      error: null,
      snapshotDate: snapshot.snapshotDate,
      generatedAt: snapshot.generatedAt,
      recordCount: 'recordCount' in snapshot ? snapshot.recordCount : snapshot.rows.length,
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
