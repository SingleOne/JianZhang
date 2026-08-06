import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DAILY_MARKET_SCAN_KLINE_LIMIT,
  DAILY_MARKET_SCAN_MINIMUM_AMOUNT,
  createDailyMarketScanRow,
  dailyMarketScanTradingDate
} from '../../src/lib/daily-market-scan'
import type {
  DailyMarketScanResult,
  DailyMarketScanState,
  KlineResult
} from '../../src/shared/types'
import type { HistoricalKlineCache } from './historical-kline-cache'
import type { DailyMarketActiveQuote, DailyMarketActiveQuotesResult } from './market'

const KLINE_CONCURRENCY = 8
const EMPTY_STATE: DailyMarketScanState = {
  running: false,
  progress: {
    stage: 'idle',
    message: '尚未执行收盘扫描。',
    completed: 0,
    total: 0
  },
  error: null
}

interface DailyMarketScanDependencies {
  userDataDirectory: string
  historicalKlineCache: HistoricalKlineCache
  getClosedDates: () => readonly string[]
  fetchActiveQuotes: (minimumAmount: number) => Promise<DailyMarketActiveQuotesResult>
  fetchKline: (
    quoteId: string,
    period: 'daily',
    limit: number,
    caller: string
  ) => Promise<KlineResult>
  notifyState: (state: DailyMarketScanState) => void
}

interface LoadedKline {
  quote: DailyMarketActiveQuote
  data: KlineResult
}

export class DailyMarketScanService {
  private readonly directory: string
  private readonly snapshotPath: string
  private snapshot: DailyMarketScanResult | null = null
  private state: DailyMarketScanState = EMPTY_STATE
  private runningTask: Promise<DailyMarketScanResult> | null = null

  constructor(private readonly dependencies: DailyMarketScanDependencies) {
    this.directory = join(dependencies.userDataDirectory, 'daily-market-scan')
    this.snapshotPath = join(this.directory, 'latest.json')
    this.loadSnapshot()
  }

  getResult(): DailyMarketScanResult | null {
    return this.snapshot
  }

  getState(): DailyMarketScanState {
    return {
      ...this.state,
      progress: { ...this.state.progress }
    }
  }

  run(): Promise<DailyMarketScanResult> {
    if (this.runningTask) return this.runningTask
    const task = this.execute()
    this.runningTask = task
    task.then(
      () => this.finishTask(task),
      () => this.finishTask(task)
    )
    return task
  }

  private async execute(): Promise<DailyMarketScanResult> {
    this.setState({
      running: true,
      progress: {
        stage: 'quotes',
        message: '正在获取全市场 A 股行情…',
        completed: 0,
        total: 0
      },
      error: null
    })

    try {
      const market = await this.dependencies.fetchActiveQuotes(DAILY_MARKET_SCAN_MINIMUM_AMOUNT)
      this.setState({
        running: true,
        progress: {
          stage: 'klines',
          message: `已筛出 ${market.quotes.length.toLocaleString('zh-CN')} 只活跃股票，正在获取日 K…`,
          completed: 0,
          total: market.quotes.length
        },
        error: null
      })

      const { loaded, failed } = await this.loadKlines(market.quotes)
      this.setState({
        running: true,
        progress: {
          stage: 'calculating',
          message: '日 K 获取完成，正在计算量价信号…',
          completed: loaded.length,
          total: market.quotes.length
        },
        error: null
      })

      const rows = loaded.flatMap(({ quote, data }) => {
        const row = createDailyMarketScanRow(quote, data.bars)
        return row ? [row] : []
      })
      const fallbackTradingDate =
        loaded
          .flatMap(({ data }) => data.bars.at(-1)?.time.slice(0, 10) ?? [])
          .sort()
          .at(-1) ?? new Date().toISOString().slice(0, 10)
      const result: DailyMarketScanResult = {
        schemaVersion: 1,
        tradingDate: dailyMarketScanTradingDate(rows) || fallbackTradingDate,
        generatedAt: new Date().toISOString(),
        source: market.source,
        universeCount: market.universeCount,
        activeCount: market.quotes.length,
        klineSuccessCount: loaded.length,
        klineFailureCount: failed,
        signalCount: rows.reduce((total, row) => total + row.signals.length, 0),
        rows
      }
      this.saveSnapshot(result)
      this.snapshot = result
      this.setState({
        running: false,
        progress: {
          stage: 'completed',
          message: `扫描完成，共发现 ${result.signalCount} 条信号，涉及 ${result.rows.length} 只股票。`,
          completed: market.quotes.length,
          total: market.quotes.length
        },
        error: null
      })
      return result
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '收盘扫描失败'
      this.setState({
        running: false,
        progress: {
          ...this.state.progress,
          stage: 'failed',
          message
        },
        error: message
      })
      throw new Error(message)
    }
  }

  private async loadKlines(quotes: readonly DailyMarketActiveQuote[]): Promise<{
    loaded: LoadedKline[]
    failed: number
  }> {
    const loaded: LoadedKline[] = []
    let failed = 0
    let nextIndex = 0
    let completed = 0

    const worker = async () => {
      while (nextIndex < quotes.length) {
        const quote = quotes[nextIndex]
        nextIndex += 1
        try {
          loaded.push({ quote, data: await this.loadKline(quote) })
        } catch {
          failed += 1
        }
        completed += 1
        if (completed === quotes.length || completed % 10 === 0) {
          this.setState({
            running: true,
            progress: {
              stage: 'klines',
              message: `正在获取日 K：${completed.toLocaleString('zh-CN')} / ${quotes.length.toLocaleString('zh-CN')}`,
              completed,
              total: quotes.length
            },
            error: null
          })
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(KLINE_CONCURRENCY, quotes.length) }, () => worker())
    )
    return { loaded, failed }
  }

  private async loadKline(quote: DailyMarketActiveQuote): Promise<KlineResult> {
    const cache = this.dependencies.historicalKlineCache
    const cached = cache.get(
      quote.quoteId,
      'daily',
      DAILY_MARKET_SCAN_KLINE_LIMIT,
      this.dependencies.getClosedDates()
    )
    if (cached && (!quote.tradingDate || cached.bars.at(-1)?.time.startsWith(quote.tradingDate))) {
      return cached
    }

    const data = await this.dependencies.fetchKline(
      quote.quoteId,
      'daily',
      DAILY_MARKET_SCAN_KLINE_LIMIT,
      'daily-market-scan:kline'
    )
    if (quote.tradingDate && !data.bars.at(-1)?.time.startsWith(quote.tradingDate)) {
      throw new Error(`${quote.name}日 K 尚未更新至 ${quote.tradingDate}`)
    }
    if (cache.shouldKeepFallback('daily', data)) return data
    return cache.save(quote.quoteId, 'daily', DAILY_MARKET_SCAN_KLINE_LIMIT, data)
  }

  private loadSnapshot(): void {
    if (!existsSync(this.snapshotPath)) return
    try {
      const snapshot = JSON.parse(readFileSync(this.snapshotPath, 'utf8')) as DailyMarketScanResult
      if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.rows)) return
      this.snapshot = snapshot
      this.state = {
        running: false,
        progress: {
          stage: 'completed',
          message: `已加载 ${snapshot.tradingDate} 的收盘扫描结果。`,
          completed: snapshot.activeCount,
          total: snapshot.activeCount
        },
        error: null
      }
    } catch {}
  }

  private saveSnapshot(snapshot: DailyMarketScanResult): void {
    mkdirSync(this.directory, { recursive: true })
    const nextPath = join(this.directory, 'latest.next.json')
    writeFileSync(nextPath, JSON.stringify(snapshot), 'utf8')
    renameSync(nextPath, this.snapshotPath)
  }

  private setState(state: DailyMarketScanState): void {
    this.state = state
    this.dependencies.notifyState(this.getState())
  }

  private finishTask(task: Promise<DailyMarketScanResult>): void {
    if (this.runningTask === task) this.runningTask = null
  }
}
