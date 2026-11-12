import { describe, expect, it, vi } from 'vitest'
import type { KlineAdjustment, KlineResult, StockDesktopApi } from '../../shared/types'
import { createDetailCenter } from './details'

function result(adjustment: KlineAdjustment): KlineResult {
  return { quoteId: '1.600000', name: '测试', tradingDate: '2026-11-12', bars: [], adjustment }
}

function history(adjustment: KlineAdjustment, days: string[]): KlineResult {
  return {
    ...result(adjustment),
    bars: days.map((time) => ({
      time,
      open: 10,
      close: 10,
      high: 11,
      low: 9,
      volume: 100,
      amount: 1000
    }))
  }
}

describe('K-line adjustment resources', () => {
  it('keeps a late response from replacing another adjustment and reuses each cached mode', async () => {
    const pending = new Map<KlineAdjustment, (data: KlineResult) => void>()
    const getKline = vi
      .fn<StockDesktopApi['getKline']>()
      .mockImplementation(
        (_quoteId, _period, _limit, adjustment = 'forward') =>
          new Promise((resolve) => pending.set(adjustment, resolve))
      )
    const details = createDetailCenter({ getKline } as unknown as StockDesktopApi)
    const forward = details.kline('1.600000', 'daily', 120)
    const backward = details.kline('1.600000', 'daily', 120, 'backward')
    expect(details.kline('1.600000', 'daily', 120, 'forward')).toBe(forward)

    const first = forward.request()
    const second = backward.request()
    await vi.waitFor(() => expect(getKline).toHaveBeenCalledTimes(2))
    pending.get('backward')!(result('backward'))
    await second
    pending.get('forward')!(result('forward'))
    await first
    expect(backward.getSnapshot().data?.adjustment).toBe('backward')
    expect(forward.getSnapshot().data?.adjustment).toBe('forward')

    await backward.request()
    await forward.request()
    expect(getKline).toHaveBeenCalledTimes(2)
    expect(getKline).toHaveBeenCalledWith('1.600000', 'daily', 120, 'backward')

    details.invalidate('1.600000', ['klines'])
    expect(backward.getSnapshot().data).toBeUndefined()
    expect(forward.getSnapshot().data).toBeUndefined()
    details.dispose()
  })

  it('shares minute resources regardless of the historical adjustment selection', async () => {
    const getKline = vi.fn<StockDesktopApi['getKline']>().mockResolvedValue(result('none'))
    const details = createDetailCenter({ getKline } as unknown as StockDesktopApi)
    for (const period of ['intraday', 'fiveDay'] as const) {
      const resource = details.kline('1.600000', period)
      expect(details.kline('1.600000', period, undefined, 'backward')).toBe(resource)
      expect(details.kline('1.600000', period, undefined, 'none')).toBe(resource)
      await resource.request()
      expect(getKline).toHaveBeenCalledWith('1.600000', period, undefined, 'none')
    }
    details.dispose()
  })
})

describe('historical K-line pagination', () => {
  it.each(['daily', 'weekly', 'monthly'] as const)(
    'keeps %s bars available throughout a larger history request',
    async (period) => {
      const initial = history('backward', ['2026-11-11', '2026-11-12'])
      const expanded = history('backward', ['2026-11-10', '2026-11-11', '2026-11-12'])
      let resolveMore!: (data: KlineResult) => void
      const getKline = vi
        .fn<StockDesktopApi['getKline']>()
        .mockResolvedValueOnce(initial)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveMore = resolve
            })
        )
      const details = createDetailCenter({ getKline } as unknown as StockDesktopApi)
      await details.kline('1.600000', period, 120, 'backward').request()

      const more = details.kline('1.600000', period, 240, 'backward')
      expect(more.getSnapshot().data).toBe(initial)
      const request = more.request()
      expect(more.getSnapshot()).toMatchObject({ data: initial, loading: true, error: '' })
      await vi.waitFor(() => expect(getKline).toHaveBeenCalledTimes(2))
      expect(getKline).toHaveBeenLastCalledWith('1.600000', period, 240, 'backward')
      resolveMore(expanded)
      await request
      expect(more.getSnapshot()).toMatchObject({ data: expanded, loading: false, error: '' })

      const nextPage = details.kline('1.600000', period, 480, 'backward')
      expect(nextPage.getSnapshot().data).toBe(expanded)
      details.dispose()
    }
  )

  it('retains the current bars after a history load fails and can retry', async () => {
    const initial = history('forward', ['2026-11-12'])
    const expanded = history('forward', ['2026-11-11', '2026-11-12'])
    const getKline = vi
      .fn<StockDesktopApi['getKline']>()
      .mockResolvedValueOnce(initial)
      .mockRejectedValueOnce(new Error('加载失败'))
      .mockResolvedValueOnce(expanded)
    const details = createDetailCenter({ getKline } as unknown as StockDesktopApi)
    await details.kline('1.600000', 'daily', 120).request()
    const more = details.kline('1.600000', 'daily', 240)

    await expect(more.request()).rejects.toThrow('加载失败')
    expect(more.getSnapshot()).toMatchObject({ data: initial, loading: false, error: '加载失败' })
    await more.request(true)
    expect(more.getSnapshot()).toMatchObject({ data: expanded, loading: false, error: '' })
    details.dispose()
  })

  it('isolates previous bars by stock, period and adjustment and respects cache clearing', async () => {
    const getKline = vi
      .fn<StockDesktopApi['getKline']>()
      .mockResolvedValue(history('forward', ['2026-11-12']))
    const details = createDetailCenter({ getKline } as unknown as StockDesktopApi)
    await details.kline('1.600000', 'daily', 120).request()

    expect(details.kline('0.000001', 'daily', 240).getSnapshot().data).toBeUndefined()
    expect(details.kline('1.600000', 'weekly', 240).getSnapshot().data).toBeUndefined()
    expect(details.kline('1.600000', 'monthly', 240).getSnapshot().data).toBeUndefined()
    expect(details.kline('1.600000', 'daily', 240, 'backward').getSnapshot().data).toBeUndefined()
    expect(details.kline('1.600000', 'daily', 240, 'none').getSnapshot().data).toBeUndefined()
    expect(details.kline('1.600000', 'daily', 240).getSnapshot().data?.bars).toHaveLength(1)

    details.invalidate('1.600000', ['klines'])
    expect(details.kline('1.600000', 'daily', 240).getSnapshot().data).toBeUndefined()
    expect(details.kline('1.600000', 'daily', 480).getSnapshot().data).toBeUndefined()
    details.dispose()
  })
})
