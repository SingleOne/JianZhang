import { describe, expect, it } from 'vitest'
import type { KlineBar, StockQuote } from '../shared/types'
import { createDailyMarketScanRow, dailyMarketScanBoardLabel } from './daily-market-scan'

function bars(closes: number[], volumes: number[] = closes.map(() => 100)): KlineBar[] {
  return closes.map((close, index) => ({
    time: `2026-07-${String(index + 1).padStart(2, '0')}`,
    open: close,
    close,
    high: close,
    low: close,
    volume: volumes[index],
    amount: close * volumes[index]
  }))
}

function quote(overrides: Partial<StockQuote> = {}): StockQuote {
  return {
    code: '600001',
    name: '测试股票',
    quoteId: '1.600001',
    latest: 10,
    change: 0.6,
    changePercent: 6,
    open: 9.5,
    high: 10,
    low: 9.4,
    previousClose: 9.4,
    volume: 200,
    amount: 100_000_000,
    turnoverRate: 2,
    updatedAt: '2026-07-21T07:00:00.000Z',
    ...overrides
  }
}

describe('createDailyMarketScanRow', () => {
  it('uses the previous 20 sessions for volume and breakout comparisons', () => {
    const result = createDailyMarketScanRow(
      quote({ volume: 300, latest: 12, changePercent: 6 }),
      bars([8, 9, 10, ...Array.from({ length: 20 }, (_, index) => 10 + index * 0.05), 12])
    )

    expect(result?.averageVolume20d).toBe(100)
    expect(result?.volumeRatio).toBe(3)
    expect(result?.turnoverRate).toBe(2)
    expect(result?.signals).toContain('volumeSurge')
    expect(result?.signals).toContain('strongGain')
    expect(result?.signals).toContain('breakout20d')
    expect(result?.breakoutPercent).toBeGreaterThan(0)
  })

  it('detects four down sessions in the previous five and a positive reversal', () => {
    const closes = [...Array.from({ length: 17 }, () => 12), 12, 11.7, 11.4, 11.1, 11.2, 10.8, 11.1]
    const result = createDailyMarketScanRow(
      quote({ latest: 11.1, changePercent: 2.78, volume: 100 }),
      bars(closes)
    )

    expect(result?.declineDays).toBe(4)
    expect(result?.previousFiveDayReturn).toBeLessThan(-5)
    expect(result?.signals).toEqual(['reversal'])
  })

  it('detects a volume-backed large loss and a new 20-session low', () => {
    const result = createDailyMarketScanRow(
      quote({ latest: 9.3, changePercent: -6, volume: 200 }),
      bars([...Array.from({ length: 23 }, () => 10), 9.3])
    )

    expect(result?.volumeRatio).toBe(2)
    expect(result?.signals).toEqual(['strongLoss', 'breakdown20d'])
    expect(result?.breakdownPercent).toBeCloseTo(-7)
  })

  it('identifies ChiNext and STAR Market stock codes', () => {
    expect(dailyMarketScanBoardLabel('300750')).toBe('创业板')
    expect(dailyMarketScanBoardLabel('301269')).toBe('创业板')
    expect(dailyMarketScanBoardLabel('688981')).toBe('科创板')
    expect(dailyMarketScanBoardLabel('600519')).toBeNull()
  })

  it('keeps threshold comparisons strict and ignores incomplete history', () => {
    expect(
      createDailyMarketScanRow(
        quote({ changePercent: 5, volume: 250 }),
        bars(Array.from({ length: 24 }, () => 10))
      )
    ).toBeNull()
    expect(
      createDailyMarketScanRow(quote({ volume: 300 }), bars(Array.from({ length: 23 }, () => 10)))
    ).toBeNull()
  })

  it('adds upper and lower shadow signals without requiring another scan signal', () => {
    const upperBars = bars(Array.from({ length: 24 }, () => 10))
    upperBars[23] = { ...upperBars[23], open: 9, close: 10, high: 11, low: 8.5 }
    const lowerBars = bars(Array.from({ length: 24 }, () => 10))
    lowerBars[23] = { ...lowerBars[23], open: 11, close: 10, high: 11.5, low: 9 }

    expect(createDailyMarketScanRow(quote({ changePercent: 0 }), upperBars)?.signals).toContain(
      'longUpperShadow'
    )
    expect(createDailyMarketScanRow(quote({ changePercent: 0 }), lowerBars)?.signals).toContain(
      'longLowerShadow'
    )
  })

  it('adds a continuous Bollinger bandwidth signal', () => {
    const closes = [...Array.from({ length: 19 }, () => 10), 9.9, 10.5, 11, 11.5, 12]
    const result = createDailyMarketScanRow(
      quote({ latest: 12, changePercent: 4, volume: 100 }),
      bars(closes)
    )

    expect(result?.signals).toContain('bollingerExpansion')
  })
})
