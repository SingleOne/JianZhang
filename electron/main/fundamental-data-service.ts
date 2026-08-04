import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { fundamentalStaleReason } from '../../src/lib/data-snapshot-status'
import { parseFundamentalSnapshot } from '../../src/lib/fundamentals'
import type {
  DataSnapshotRuntimeState,
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
  private snapshotCache: FundamentalSnapshot | null = null
  private runtimeState: DataSnapshotRuntimeState = EMPTY_STATE
  private updating = false

  constructor(
    userDataDirectory: string,
    private readonly pythonQueue: PythonTaskQueue,
    private readonly notifyProgress: (progress: FundamentalUpdateProgress) => void,
    private readonly notifyState: (state: DataSnapshotRuntimeState) => void
  ) {
    this.dataDirectory = join(userDataDirectory, 'fundamentals')
    this.snapshotPath = join(this.dataDirectory, 'snapshot.json')
    this.diagnosticsPath = join(this.dataDirectory, 'diagnostics.json')
    this.loadSnapshot()
  }

  getSnapshot(): FundamentalSnapshot | null {
    return this.snapshotCache
  }

  getState(): DataSnapshotRuntimeState {
    return { ...this.runtimeState }
  }

  initializeIfMissing(): void {
    if (this.runtimeState.status === 'missing') void this.runUpdate().catch(() => undefined)
  }

  async runUpdate(): Promise<FundamentalUpdateResult> {
    if (this.updating) throw new Error('基本面财务数据更新脚本正在运行')
    this.updating = true
    mkdirSync(this.dataDirectory, { recursive: true })
    const previousSnapshot = this.snapshotCache
    const nextSnapshotPath = join(this.dataDirectory, 'snapshot.next.json')
    const nextDiagnosticsPath = join(this.dataDirectory, 'diagnostics.next.json')
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
        [
          '--output',
          nextSnapshotPath,
          '--diagnostics',
          nextDiagnosticsPath
        ],
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
      renameSync(nextDiagnosticsPath, this.diagnosticsPath)
      renameSync(nextSnapshotPath, this.snapshotPath)
      this.snapshotCache = snapshot
      this.setState(this.snapshotState(snapshot))
      this.notifyProgress({
        stage: 'completed',
        message: `基本面数据更新完成：${snapshot.rows.length} 家公司，${snapshot.fiscalYears[0]}—${snapshot.fiscalYears.at(-1)} 年`
      })
      return { snapshot, snapshotPath: this.snapshotPath, diagnosticsPath: this.diagnosticsPath }
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

  private loadSnapshot(): void {
    if (!existsSync(this.snapshotPath)) return
    try {
      this.snapshotCache = parseFundamentalSnapshot(readFileSync(this.snapshotPath, 'utf8'))
      this.runtimeState = this.snapshotState(this.snapshotCache)
    } catch (reason) {
      this.runtimeState = {
        ...EMPTY_STATE,
        error: reason instanceof Error ? reason.message : '基本面财务快照无法读取'
      }
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
