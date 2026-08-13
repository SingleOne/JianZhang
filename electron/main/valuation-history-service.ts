import { net } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StockValuationHistory } from '../../src/shared/types'
import { atomicWriteJsonSync } from './file-storage'

interface ValuationHistoryCacheEntry extends StockValuationHistory {
  version: 1
  cachedAt: number
}

interface EastmoneyValuationRow {
  TRADE_DATE?: string
  PE_TTM?: number | null
  PB_MRQ?: number | null
}

const CACHE_MAX_AGE = 18 * 60 * 60 * 1000

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function startOfFiveYearWindow(endDate: string): string {
  const start = new Date(`${endDate}T00:00:00Z`)
  start.setUTCFullYear(start.getUTCFullYear() - 5)
  return start.toISOString().slice(0, 10)
}

export class ValuationHistoryService {
  private readonly directory: string
  private readonly memory = new Map<string, ValuationHistoryCacheEntry>()

  constructor(
    rootDirectory: string,
    private readonly now: () => number = Date.now
  ) {
    this.directory = join(rootDirectory, 'valuations')
    mkdirSync(this.directory, { recursive: true })
  }

  async get(quoteId: string): Promise<StockValuationHistory> {
    const cached = this.read(quoteId)
    if (cached && this.now() - cached.cachedAt < CACHE_MAX_AGE) return cached

    const code = quoteId.split('.')[1]
    const url = new URL('https://datacenter-web.eastmoney.com/api/data/v1/get')
    url.search = new URLSearchParams({
      sortColumns: 'TRADE_DATE',
      sortTypes: '-1',
      pageSize: '5000',
      pageNumber: '1',
      reportName: 'RPT_VALUEANALYSIS_DET',
      columns: 'TRADE_DATE,PE_TTM,PB_MRQ',
      source: 'WEB',
      client: 'WEB',
      filter: `(SECURITY_CODE="${code}")`
    }).toString()
    const response = await net.fetch(url.toString(), {
      headers: {
        Referer: 'https://data.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0'
      }
    })
    if (!response.ok) throw new Error(`历史估值接口返回 ${response.status}`)
    const payload = (await response.json()) as {
      success?: boolean
      result?: { data?: EastmoneyValuationRow[] }
    }
    const rows = payload.result?.data ?? []
    if (!payload.success || rows.length === 0) throw new Error('历史估值数据暂不可用')

    const dates = rows.flatMap((row) =>
      typeof row.TRADE_DATE === 'string' ? [row.TRADE_DATE.slice(0, 10)] : []
    )
    const periodEnd = dates.sort().at(-1) ?? null
    const cutoff = periodEnd ? startOfFiveYearWindow(periodEnd) : ''
    const windowRows = rows.filter(
      (row) => typeof row.TRADE_DATE === 'string' && row.TRADE_DATE.slice(0, 10) >= cutoff
    )
    const entry: ValuationHistoryCacheEntry = {
      version: 1,
      quoteId,
      cachedAt: this.now(),
      fetchedAt: new Date(this.now()).toISOString(),
      periodStart:
        windowRows
          .flatMap((row) =>
            typeof row.TRADE_DATE === 'string' ? [row.TRADE_DATE.slice(0, 10)] : []
          )
          .sort()[0] ?? null,
      periodEnd,
      priceEarningsRatioTtmValues: windowRows.map((row) => row.PE_TTM).filter(finitePositive),
      priceBookRatioValues: windowRows.map((row) => row.PB_MRQ).filter(finitePositive)
    }
    this.memory.set(quoteId, entry)
    atomicWriteJsonSync(this.path(quoteId), entry, false)
    return entry
  }

  private path(quoteId: string): string {
    return join(this.directory, `${quoteId.replaceAll('.', '_')}.json`)
  }

  private read(quoteId: string): ValuationHistoryCacheEntry | null {
    if (this.memory.has(quoteId)) return this.memory.get(quoteId) ?? null
    const path = this.path(quoteId)
    if (!existsSync(path)) return null
    try {
      const entry = JSON.parse(readFileSync(path, 'utf8')) as ValuationHistoryCacheEntry
      if (entry.version !== 1 || entry.quoteId !== quoteId) return null
      this.memory.set(quoteId, entry)
      return entry
    } catch {
      return null
    }
  }
}
