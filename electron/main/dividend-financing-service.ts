import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dividendFinancingStaleReason } from '../../src/lib/data-snapshot-status'
import {
  createDividendFinancingChangeReport,
  parseDividendFinancingSnapshot
} from '../../src/lib/dividend-financing'
import type {
  DataSnapshotRuntimeState,
  DividendFinancingChangeReport,
  DividendFinancingOverview,
  DividendFinancingSnapshot,
  DividendFinancingUpdateProgress,
  DividendFinancingUpdateResult
} from '../../src/shared/types'
import {
  createDividendFinancingOverviewStore,
  type DividendFinancingOverviewMetadata
} from './data-overview'
import { generateDataOverviewInWorker } from './data-overview-worker-client'
import type { PythonTaskQueue } from './python-task-queue'
import { atomicWriteJsonSync } from './file-storage'
import type { IndexedOverviewManifest } from './indexed-overview-store'

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
  private readonly overviewStore: ReturnType<typeof createDividendFinancingOverviewStore>
  private overviewManifest: IndexedOverviewManifest<DividendFinancingOverviewMetadata> | null = null
  private snapshotCache: DividendFinancingSnapshot | null = null
  private changeReportCache: DividendFinancingChangeReport | null | undefined
  private runtimeState: DataSnapshotRuntimeState = EMPTY_STATE
  private updating = false
  private snapshotLoading: Promise<DividendFinancingSnapshot | null> | null = null
  private overviewGeneration: Promise<void> | null = null
  private overviewGenerationTimer: ReturnType<typeof setTimeout> | null = null
  private initialized = false

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
    this.overviewStore = createDividendFinancingOverviewStore(this.dataDirectory)
    this.overviewManifest = this.overviewStore.load(this.snapshotPath)
    if (this.overviewManifest) {
      this.runtimeState = this.snapshotState(this.overviewManifest.metadata)
    } else if (existsSync(this.snapshotPath)) {
      this.runtimeState = {
        ...EMPTY_STATE,
        status: 'queued',
        progressMessage: '正在准备分红融资轻量概览。'
      }
    }
  }

  getOverview(codes: readonly string[]): DividendFinancingOverview | null {
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
        progressMessage: '正在修复分红融资轻量概览。'
      })
      void this.generateOverview(true).catch((reason) => {
        this.setState({
          ...this.runtimeState,
          status: 'failed',
          progressMessage: null,
          error: reason instanceof Error ? reason.message : '分红融资轻量概览修复失败'
        })
      })
      return null
    }
  }

  async getSnapshot(): Promise<DividendFinancingSnapshot | null> {
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

  getChangeReport(): DividendFinancingChangeReport | null {
    if (this.changeReportCache !== undefined) return this.changeReportCache
    if (!existsSync(this.changeReportPath)) {
      this.changeReportCache = null
      return null
    }
    try {
      const report = JSON.parse(
        readFileSync(this.changeReportPath, 'utf8')
      ) as DividendFinancingChangeReport
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
          error: reason instanceof Error ? reason.message : '分红融资轻量概览生成失败'
        })
      })
    }, 1_500)
    this.overviewGenerationTimer.unref()
  }

  async runUpdate(): Promise<DividendFinancingUpdateResult> {
    if (this.overviewGenerationTimer) clearTimeout(this.overviewGenerationTimer)
    this.overviewGenerationTimer = null
    if (this.overviewGeneration) await this.overviewGeneration
    if (this.updating) throw new Error('分红融资榜更新脚本正在运行')
    this.updating = true
    mkdirSync(this.dataDirectory, { recursive: true })
    const previousSnapshot = await this.getSnapshot()
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
        atomicWriteJsonSync(this.previousSnapshotPath, previousSnapshot)
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
      await this.generateOverview()
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

  private async loadSnapshot(): Promise<DividendFinancingSnapshot | null> {
    try {
      this.snapshotCache = parseDividendFinancingSnapshot(await readFile(this.snapshotPath, 'utf8'))
      return this.snapshotCache
    } catch (reason) {
      this.setState({
        ...EMPTY_STATE,
        error: reason instanceof Error ? reason.message : '分红融资榜快照无法读取'
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
      'dividend-financing',
      this.dataDirectory,
      this.snapshotPath
    )
    this.overviewGeneration = generation
    try {
      await generation
      this.overviewManifest = this.overviewStore.load(this.snapshotPath)
      if (!this.overviewManifest) throw new Error('分红融资轻量概览无法读取')
      this.setState(this.snapshotState(this.overviewManifest.metadata))
    } finally {
      if (this.overviewGeneration === generation) this.overviewGeneration = null
    }
  }

  private snapshotState(
    snapshot: DividendFinancingSnapshot | DividendFinancingOverviewMetadata | null
  ): DataSnapshotRuntimeState {
    if (!snapshot) return { ...EMPTY_STATE }
    const staleReason = dividendFinancingStaleReason(snapshot)
    return {
      status: staleReason ? 'stale' : 'ready',
      progressMessage: null,
      error: null,
      snapshotDate: snapshot.snapshotDate,
      generatedAt: snapshot.generatedAt,
      recordCount: 'recordCount' in snapshot ? snapshot.recordCount : snapshot.rows.length,
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
