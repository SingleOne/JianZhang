import { describe, expect, it } from 'vitest'
import { createDesktopWidgetSnapshot, widgetNavigationQuoteId } from './desktop-widget'
import { DEFAULT_APP_SETTINGS, type AppState, type StockQuote } from '../shared/types'

const now = new Date('2026-10-27T10:30:00+08:00')
function state(): AppState {
  return {
    watchlist: [
      {
        quoteId: '1.600519',
        code: '600519',
        name: '贵州茅台',
        marketLabel: '沪A',
        showInTaskbar: false,
        isPriority: true,
        showRadarSignals: true,
        position: { quantity: 100, cost: 10, openedToday: false }
      }
    ],
    watchlistGroups: [{ id: 'test', name: '自选分组' }],
    stockTrackingProfiles: {},
    columnOrder: [],
    stockTradingBooks: {},
    corporateActionApplications: {},
    settings: structuredClone(DEFAULT_APP_SETTINGS)
  }
}
function quote(overrides: Partial<StockQuote> = {}): StockQuote {
  return {
    quoteId: '1.600519',
    code: '600519',
    name: '贵州茅台',
    latest: 11,
    change: 1,
    changePercent: 10,
    previousClose: 10,
    open: 10,
    high: 11,
    low: 10,
    volume: 100,
    amount: 1100,
    turnoverRate: 1,
    updatedAt: now.toISOString(),
    dataAt: now.toISOString(),
    ...overrides
  }
}

describe('desktop widget snapshots', () => {
  it('preserves the source change amount independently from rounded price and percent', () => {
    const snapshot = createDesktopWidgetSnapshot(
      state(),
      [quote({ change: -0.1234, changePercent: -1.11 })],
      undefined,
      now
    )
    expect(snapshot.stocks[0]).toMatchObject({ change: -0.1234, changePercent: -1.11, latest: 11 })
    expect(snapshot.portfolio).toMatchObject({
      count: 1,
      complete: true,
      todayProfit: 100,
      marketValue: 1100
    })
  })

  it('does not turn absent prices, source times or nonfinite data into zero', () => {
    const snapshot = createDesktopWidgetSnapshot(
      state(),
      [quote({ latest: null, change: NaN, dataAt: undefined })],
      undefined,
      now
    )
    expect(snapshot.stocks[0]).toMatchObject({
      latest: null,
      change: null,
      dataAt: null,
      status: 'unknown',
      history: []
    })
    expect(snapshot.portfolio).toMatchObject({
      complete: false,
      marketValue: null,
      todayProfit: null
    })
  })

  it('does not present a partially priced portfolio as a complete total', () => {
    const current = state()
    current.watchlist.push({
      ...current.watchlist[0],
      quoteId: '0.000001',
      code: '000001',
      name: '另一持仓'
    })
    const snapshot = createDesktopWidgetSnapshot(current, [quote()], undefined, now)
    expect(snapshot.portfolio).toMatchObject({
      count: 2,
      complete: false,
      marketValue: null,
      totalProfit: null
    })
  })

  it('withholds totals if a holding is missing previous close for its daily return', () => {
    const snapshot = createDesktopWidgetSnapshot(
      state(),
      [quote({ previousClose: null })],
      undefined,
      now
    )
    expect(snapshot.portfolio.todayProfit).toBeNull()
    expect(snapshot.portfolio.complete).toBe(false)
  })

  it('deduplicates source times and only retains samples from the current market day', () => {
    const first = createDesktopWidgetSnapshot(state(), [quote()], undefined, now)
    const duplicate = createDesktopWidgetSnapshot(
      state(),
      [quote()],
      first,
      new Date(now.getTime() + 30_000)
    )
    expect(duplicate.stocks[0].history).toHaveLength(1)
    const later = new Date(now.getTime() + 60_000)
    const second = createDesktopWidgetSnapshot(
      state(),
      [quote({ latest: 12, dataAt: later.toISOString() })],
      duplicate,
      later
    )
    expect(second.stocks[0].history.map((sample) => sample.price)).toEqual([11, 12])
    const nextDay = new Date('2026-10-28T10:30:00+08:00')
    const cleared = createDesktopWidgetSnapshot(state(), [quote()], second, nextDay)
    expect(cleared.stocks[0].history).toEqual([])
  })

  it('plans market transitions using the existing calendar and reuses that plan', () => {
    const snapshot = createDesktopWidgetSnapshot(state(), [quote()], undefined, now)
    expect(snapshot.markets.CN.map((transition) => transition.open)).toEqual([
      true,
      false,
      true,
      false,
      true
    ])
    const next = createDesktopWidgetSnapshot(
      state(),
      [quote()],
      snapshot,
      new Date(now.getTime() + 30_000)
    )
    expect(next.markets.CN).toBe(snapshot.markets.CN)
    const changed = state()
    changed.settings.tradingCalendar.markets.CN.closedDates.push('2026-10-27')
    const closed = createDesktopWidgetSnapshot(changed, [quote()], snapshot, now)
    expect(closed.stocks[0].status).toBe('closed')
    expect(closed.markets.CN[0].open).toBe(false)
  })

  it('removes deleted stocks and records app exit without changing the quote time', () => {
    const first = createDesktopWidgetSnapshot(state(), [quote()], undefined, now)
    const exited = createDesktopWidgetSnapshot(state(), [quote()], first, now, false)
    expect(exited.appRunning).toBe(false)
    expect(exited.stocks[0].dataAt).toBe(first.stocks[0].dataAt)
    const empty = state()
    empty.watchlist = []
    expect(createDesktopWidgetSnapshot(empty, [quote()], first, now).stocks).toEqual([])
  })
})

describe('widget navigation', () => {
  it('accepts app and stock links and rejects unrelated/malformed routes', () => {
    expect(widgetNavigationQuoteId('jianzhang://widget')).toBeNull()
    expect(widgetNavigationQuoteId('jianzhang://widget/stock/1.600519')).toBe('1.600519')
    for (const url of [
      'https://widget/stock/1.600519',
      'jianzhang://other',
      'invalid',
      'jianzhang://widget/stock/%ZZ',
      'jianzhang://widget/stock/1/extra'
    ]) {
      expect(widgetNavigationQuoteId(url)).toBeUndefined()
    }
  })
})
