import { describe, expect, it } from 'vitest'
import {
  createStopLossRule,
  evaluateStopLoss,
  evaluateStopLosses,
  normalizeStopLoss,
  updateStopLossReferences,
  withStopLoss,
  type StopLossRule
} from './stop-loss'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_WATCHLIST_COLUMN_ORDER,
  type AppState,
  type StockQuote,
  type WatchStock
} from './types'
import { normalizeAccountState } from './stock-accounts'
import { normalizeStateChanges } from './normalize-state-changes'
import { createUserDataBackupDocument, parseUserDataBackupDocument } from './user-data-backup'
import { createConfigDocument, parseConfigDocument } from './config'

const now = new Date('2026-11-02T02:00:00Z')
const rule: StopLossRule = {
  mode: 'trailingClose',
  percent: 5,
  referencePrice: 12,
  quoteDate: '2026-10-30',
  resetId: 'original'
}
const stock: WatchStock = {
  code: '600000',
  quoteId: '1.600000',
  name: '测试',
  marketLabel: '沪A',
  showInTaskbar: false,
  isPriority: true,
  showRadarSignals: false,
  position: { quantity: 100, cost: 10, openedToday: false },
  stopLoss: rule
}
function quote(changes: Partial<StockQuote> = {}): StockQuote {
  return {
    code: stock.code,
    quoteId: stock.quoteId,
    name: stock.name,
    latest: 11.4,
    previousClose: 13,
    change: 0,
    changePercent: 0,
    open: 12,
    high: 12,
    low: 11,
    volume: 100,
    amount: 1000,
    turnoverRate: 1,
    dataAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...changes
  }
}
function state(stocks = [stock]): AppState {
  return {
    watchlist: stocks,
    watchlistGroups: [],
    stockTrackingProfiles: {},
    settings: structuredClone(DEFAULT_APP_SETTINGS),
    columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
    stockTradingBooks: {},
    corporateActionApplications: {}
  }
}

describe('stop loss calculation and lifecycle', () => {
  it('compares equality as reached and reports remaining price distance', () => {
    expect(evaluateStopLoss(stock, quote(), now)).toMatchObject({
      stopPrice: 11.4,
      reached: true,
      distancePercent: 0
    })
    const value = evaluateStopLoss(stock, quote({ latest: 12 }), now)!
    expect(value.reached).toBe(false)
    expect(value.distancePercent).toBeCloseTo(5)
    expect(evaluateStopLoss(stock, quote({ latest: 11 }), now)?.distancePercent).toBeLessThan(0)
  })
  it.each([undefined, 0, -1, Number.NaN])(
    'does not enable for invalid or missing holdings: %s',
    (quantity) => {
      const empty = {
        ...stock,
        position: quantity === undefined ? undefined : { ...stock.position!, quantity }
      }
      expect(createStopLossRule(empty, quote(), 'fixedCost', 5, now)).toBeUndefined()
      expect(evaluateStopLoss(empty, quote(), now)).toBeNull()
      expect(Object.hasOwn(withStopLoss(empty, rule), 'stopLoss')).toBe(false)
    }
  )
  it.each([0, 100, -5, Infinity, Number.NaN])('rejects invalid percentages: %s', (percent) => {
    expect(normalizeStopLoss({ ...rule, percent })).toBeUndefined()
  })
  it('locks cost at creation and does not follow later position cost', () => {
    const fixed = createStopLossRule(stock, undefined, 'fixedCost', 5, now)!
    expect(fixed.referencePrice).toBe(10)
    const changedStock = { ...stock, stopLoss: fixed, position: { ...stock.position!, cost: 8 } }
    expect(evaluateStopLoss(changedStock, quote(), now)?.stopPrice).toBe(9.5)
    const initial = state([changedStock])
    expect(updateStopLossReferences(initial, [quote()], now)).toBe(initial.watchlist)
  })
  it('initializes moving mode from valid previous close rather than intraday price or high', () => {
    expect(
      createStopLossRule(stock, quote({ latest: 15, high: 16 }), 'trailingClose', 5, now)
    ).toMatchObject({ referencePrice: 13, quoteDate: '2026-11-02' })
    expect(
      createStopLossRule(stock, quote({ dataAt: undefined }), 'trailingClose', 5, now)
    ).toBeUndefined()
  })
  it('raises once, preserves saved highs on a fall, and does not replay missing history', () => {
    const initial = state()
    const raised = updateStopLossReferences(initial, [quote()], now)
    expect(raised[0].stopLoss).toMatchObject({ referencePrice: 13, quoteDate: '2026-11-02' })
    const next = { ...initial, watchlist: raised }
    expect(updateStopLossReferences(next, [quote()], now)).toBe(raised)
    expect(updateStopLossReferences(next, [quote({ previousClose: 10 })], now)).toBe(raised)
  })
  it('ignores old, invalid, future and stale prices and never reports them as safe', () => {
    for (const invalid of [
      quote({ dataAt: undefined }),
      quote({ dataAt: 'invalid' }),
      quote({ dataAt: '2026-11-03T02:00:00Z' }),
      quote({ dataAt: '2026-11-02T01:00:00Z' })
    ]) {
      const initial = state()
      expect(updateStopLossReferences(initial, [invalid], now)).toBe(initial.watchlist)
      expect(evaluateStopLoss(stock, invalid, now)?.reached).toBeNull()
    }
    expect(evaluateStopLoss(stock, quote({ latest: 0 }), now)?.reached).toBeNull()
  })
  it('removes a rule when the position is closed', () => {
    const initial = state([{ ...stock, position: undefined }])
    expect(Object.hasOwn(updateStopLossReferences(initial, [], now)[0], 'stopLoss')).toBe(false)
    expect(evaluateStopLosses(initial, [quote()], now)).toEqual([])
  })
  it('preserves high watermarks in both configuration and Gist backup documents', () => {
    const initial = normalizeAccountState(state())
    const config = parseConfigDocument(
      JSON.parse(JSON.stringify(createConfigDocument(initial, 'test')))
    )
    const backup = parseUserDataBackupDocument(
      JSON.parse(JSON.stringify(createUserDataBackupDocument(initial, 'test', [], {})))
    )
    expect(config.watchlist[0].stopLoss).toEqual(rule)
    expect(backup.state.watchlist[0].stopLoss).toEqual(rule)
    const disabled = normalizeAccountState({
      ...initial,
      watchlist: initial.watchlist.map((s) => withStopLoss(s, undefined))
    })
    expect(JSON.stringify(createUserDataBackupDocument(disabled, 'test', [], {}))).not.toContain(
      'stopLoss'
    )
  })
  it('drops imported rules for empty portfolios and keeps legacy backups without rules', () => {
    const empty = normalizeAccountState(state([{ ...stock, position: undefined }]))
    expect(Object.hasOwn(empty.watchlist[0], 'stopLoss')).toBe(false)
    const legacy = normalizeAccountState(state([withStopLoss(stock, undefined)]))
    expect(Object.hasOwn(legacy.watchlist[0], 'stopLoss')).toBe(false)
  })
  it('prevents a stale editor from reducing a saved high, while allowing an explicit reset', () => {
    const before = normalizeAccountState(state())
    const stale = {
      ...before,
      watchlist: [{ ...before.watchlist[0], stopLoss: { ...rule, percent: 6, referencePrice: 10 } }]
    }
    expect(normalizeStateChanges(before, stale).watchlist[0].stopLoss?.referencePrice).toBe(12)
    stale.watchlist[0].stopLoss = { ...stale.watchlist[0].stopLoss!, resetId: 'new' }
    expect(normalizeStateChanges(before, stale).watchlist[0].stopLoss?.referencePrice).toBe(10)
  })
})
