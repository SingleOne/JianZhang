import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StockQuote, TPlanLevel, TTrade, TTradingBatch, WatchStock } from '../shared/types'
import { applyTAlertTriggers, getTriggeredTAlertBadges } from './t-alerts'
import { applyStockAlertTriggers } from './stock-alerts'

const EMPTY_FEES = {
  commission: 0,
  handling: 0,
  regulatory: 0,
  transfer: 0,
  stampDuty: 0
}

function levels(): TPlanLevel[] {
  return [1, 2, 3, 4, 5].map((targetPercent) => ({
    targetPercent,
    quantity: 100,
    alertStatus: 'armed'
  }))
}

function tTrade(): TTrade {
  return {
    id: 'buy',
    side: 'buy',
    purpose: 't',
    tradedAt: '2026-07-31T01:30:00.000Z',
    price: 10,
    quantity: 1_000,
    fees: EMPTY_FEES,
    note: ''
  }
}

function tBatch(): TTradingBatch {
  return {
    id: 'batch-1',
    sequence: 1,
    openedAt: '2026-07-31T01:30:00.000Z',
    direction: 'forward',
    buyLevels: levels(),
    sellLevels: levels(),
    alertEnabled: true
  }
}

function quote(latest: number): StockQuote {
  return {
    code: '600000',
    name: '浦发银行',
    quoteId: '1.600000',
    latest,
    change: null,
    changePercent: null,
    open: null,
    high: null,
    low: null,
    previousClose: 10,
    volume: null,
    amount: null,
    turnoverRate: null,
    updatedAt: '2026-07-31T07:00:00.000Z'
  }
}

describe('T plan alerts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T08:00:00+08:00'))
  })

  afterEach(() => vi.useRealTimers())

  it('shows only the highest triggered sell level and rearms levels after price falls', () => {
    const first = applyTAlertTriggers(tBatch(), [tTrade()], 10.31)
    expect(first.batch.sellLevels.slice(0, 3).map((level) => level.alertStatus)).toEqual([
      'triggered',
      'triggered',
      'triggered'
    ])
    expect(getTriggeredTAlertBadges(first.batch, [tTrade()])).toMatchObject([
      {
        side: 'sell',
        index: 2,
        label: 'T3'
      }
    ])

    const second = applyTAlertTriggers(first.batch, [tTrade()], 10.15)
    expect(second.batch.sellLevels.map((level) => level.alertStatus)).toEqual([
      'triggered',
      'armed',
      'armed',
      'armed',
      'armed'
    ])
    expect(getTriggeredTAlertBadges(second.batch, [tTrade()])[0].label).toBe('T1')
  })

  it('triggers buy levels below their target and clears sell levels', () => {
    const sellTriggered = applyTAlertTriggers(tBatch(), [tTrade()], 10.31).batch
    const buyTriggered = applyTAlertTriggers(sellTriggered, [tTrade()], 9.69).batch

    expect(buyTriggered.buyLevels?.slice(0, 3).map((level) => level.alertStatus)).toEqual([
      'triggered',
      'triggered',
      'triggered'
    ])
    expect(buyTriggered.sellLevels.every((level) => level.alertStatus === 'armed')).toBe(true)
    expect(getTriggeredTAlertBadges(buyTriggered, [tTrade()])).toMatchObject([
      {
        side: 'buy',
        index: 2,
        label: 'T3'
      }
    ])
  })

  it('triggers T5 at the exact target and clears every level after leaving the range', () => {
    const triggered = applyTAlertTriggers(tBatch(), [tTrade()], 10.5).batch
    expect(getTriggeredTAlertBadges(triggered, [tTrade()])[0].label).toBe('T5')

    const cleared = applyTAlertTriggers(triggered, [tTrade()], 10).batch
    expect(cleared.sellLevels.every((level) => level.alertStatus === 'armed')).toBe(true)
    expect(getTriggeredTAlertBadges(cleared, [tTrade()])).toEqual([])
  })

  it('does not change levels while the master switch is disabled', () => {
    const batch = { ...tBatch(), alertEnabled: false }
    const result = applyTAlertTriggers(batch, [tTrade()], 11)
    expect(result.changed).toBe(false)
    expect(result.batch).toBe(batch)
  })
})

describe('stock alerts', () => {
  const stock: WatchStock = {
    code: '600000',
    name: '浦发银行',
    quoteId: '1.600000',
    marketLabel: '沪A',
    showInTaskbar: false,
    isPriority: false,
    showRadarSignals: true,
    alertRules: [
      {
        id: 'price-target',
        metric: 'price',
        operator: 'gte',
        target: 10,
        enabled: true,
        status: 'armed'
      }
    ]
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T08:00:00+08:00'))
  })

  afterEach(() => vi.useRealTimers())

  it('triggers at the exact boundary and rearms below the boundary', () => {
    const triggered = applyStockAlertTriggers([stock], [quote(10)], {})
    expect(triggered.changed).toBe(true)
    expect(triggered.triggered).toHaveLength(1)
    expect(triggered.watchlist[0].alertRules?.[0].status).toBe('triggered')

    const rearmed = applyStockAlertTriggers(triggered.watchlist, [quote(9.99)], {})
    expect(rearmed.watchlist[0].alertRules?.[0]).toMatchObject({
      status: 'armed',
      triggeredAt: undefined
    })
  })
})
