import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PositionMetrics } from '../../lib/portfolio'
import type { StockQuote, WatchStock } from '../../shared/types'
import { sortRows, sortValue, type StockRowData } from './columns'

const EMPTY_METRICS: PositionMetrics = {
  marketValue: null,
  todayProfit: null,
  todayProfitPercent: null,
  todayCostBasis: null,
  totalProfit: null,
  profitPercent: null
}

function stock(quoteId: string, name: string): WatchStock {
  return {
    quoteId,
    code: quoteId,
    name,
    marketLabel: '测试',
    showInTaskbar: false,
    isPriority: false,
    showRadarSignals: true
  }
}

function quote(quoteId: string, latest: number | null): StockQuote {
  return {
    quoteId,
    code: quoteId,
    name: quoteId,
    latest,
    change: null,
    changePercent: null,
    open: null,
    high: null,
    low: null,
    previousClose: null,
    volume: null,
    amount: null,
    turnoverRate: null,
    updatedAt: '2026-07-31 10:00:00'
  }
}

function row(
  quoteId: string,
  name: string,
  latest: number | null,
  manualIndex: number,
  metrics: Partial<PositionMetrics> = {}
): StockRowData {
  return {
    stock: stock(quoteId, name),
    quote: quote(quoteId, latest),
    metrics: { ...EMPTY_METRICS, ...metrics },
    manualIndex
  }
}

describe('watchlist column sorting', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T10:00:00+08:00'))
  })

  afterEach(() => vi.useRealTimers())

  it('sorts numeric columns and keeps missing values at the end', () => {
    const rows = [
      row('missing', 'Missing', null, 0),
      row('low', 'Low', 10, 1),
      row('high', 'High', 20, 2)
    ]

    expect(
      sortRows(rows, { column: 'latest', direction: 'desc' }, []).map(({ stock }) => stock.quoteId)
    ).toEqual(['high', 'low', 'missing'])
  })

  it('uses manual order as the fallback when both values are missing', () => {
    const rows = [
      row('second', 'Second', null, 2),
      row('first', 'First', null, 0),
      row('middle', 'Middle', null, 1)
    ]

    expect(
      sortRows(rows, { column: 'latest', direction: 'asc' }, []).map(({ stock }) => stock.quoteId)
    ).toEqual(['first', 'middle', 'second'])
  })

  it('sorts derived position metrics without changing the input array', () => {
    const rows = [
      row('loss', 'Loss', 10, 0, { totalProfit: -200 }),
      row('profit', 'Profit', 10, 1, { totalProfit: 500 })
    ]

    const sorted = sortRows(rows, { column: 'totalProfit', direction: 'desc' }, [])

    expect(sorted.map(({ stock }) => stock.quoteId)).toEqual(['profit', 'loss'])
    expect(rows.map(({ stock }) => stock.quoteId)).toEqual(['loss', 'profit'])
  })

  it('uses only current-day radar signals as the radar sort value', () => {
    const current = row('current', 'Current', 10, 0)
    current.quote!.radarSignals = [
      {
        type: '8201',
        label: '快速拉升',
        date: '20260731',
        time: '10:00',
        info: '',
        direction: 'up'
      }
    ]
    const historical = row('historical', 'Historical', 10, 1)
    historical.quote!.radarSignals = [
      {
        type: '8201',
        label: '快速拉升',
        date: '20260730',
        time: '10:00',
        info: '',
        direction: 'up'
      }
    ]

    expect(sortValue(current, 'radar', [])).toBe('20260731 10:00')
    expect(sortValue(historical, 'radar', [])).toBeNull()
  })
})
