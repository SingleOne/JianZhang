import { describe, expect, it } from 'vitest'
import type { StockQuote } from '../shared/types'
import { reconcileStockQuotes } from './quote-state'

function quote(quoteId: string, latest: number): StockQuote {
  return {
    quoteId,
    code: quoteId,
    name: quoteId,
    latest,
    change: 0,
    changePercent: 0,
    open: latest,
    high: latest,
    low: latest,
    previousClose: latest,
    volume: 100,
    amount: 1000,
    turnoverRate: 1,
    sector: {
      quoteId: 'sector-1',
      code: 'BK0001',
      name: '测试板块',
      changePercent: 0.5
    },
    radarSignals: [
      {
        type: '8201',
        label: '快速拉升',
        date: '20260731',
        time: '10:00',
        info: '测试',
        direction: 'up'
      }
    ],
    fiveLevelLargeOrders: [
      { side: 'buy', level: 1, price: latest, volume: 1000, otherLevelsVolume: 200 }
    ],
    updatedAt: '2026-07-31 10:00:00'
  }
}

describe('quote state reconciliation', () => {
  it('reuses the complete snapshot when IPC returns equivalent cloned data', () => {
    const current = [quote('stock-1', 10), quote('stock-2', 20)]
    const incoming = structuredClone(current)

    const reconciled = reconcileStockQuotes(current, incoming)

    expect(reconciled).toBe(current)
    expect(reconciled[0]).toBe(current[0])
    expect(reconciled[1]).toBe(current[1])
  })

  it('replaces only the quote whose market data changed', () => {
    const current = [quote('stock-1', 10), quote('stock-2', 20)]
    const incoming = structuredClone(current)
    incoming[0].latest = 10.5
    incoming[0].updatedAt = '2026-07-31 10:00:05'

    const reconciled = reconcileStockQuotes(current, incoming)

    expect(reconciled).not.toBe(current)
    expect(reconciled[0]).toBe(incoming[0])
    expect(reconciled[1]).toBe(current[1])
  })

  it('detects nested radar, five-level and sector changes', () => {
    const current = [quote('stock-1', 10)]

    const radarChanged = structuredClone(current)
    radarChanged[0].radarSignals![0].info = '异动更新'
    expect(reconcileStockQuotes(current, radarChanged)[0]).toBe(radarChanged[0])

    const fiveLevelChanged = structuredClone(current)
    fiveLevelChanged[0].fiveLevelLargeOrders![0].volume = 2000
    expect(reconcileStockQuotes(current, fiveLevelChanged)[0]).toBe(fiveLevelChanged[0])

    const sectorChanged = structuredClone(current)
    sectorChanged[0].sector!.changePercent = 1
    expect(reconcileStockQuotes(current, sectorChanged)[0]).toBe(sectorChanged[0])
  })
})
