import { describe, expect, it, vi } from 'vitest'
import { QuoteRefreshCoordinator, type QuoteRefreshBatch } from './quote-refresh-coordinator'

describe('QuoteRefreshCoordinator', () => {
  it('coalesces targeted stock refreshes without adding a full-market scope', async () => {
    const run = vi.fn(async (batch: QuoteRefreshBatch) => batch)
    const coordinator = new QuoteRefreshCoordinator({
      getPriorityIntervalMilliseconds: () => 5_000,
      getRegularIntervalMilliseconds: () => 10_000,
      canAutoRefresh: () => true,
      run
    })

    const [first, second] = await Promise.all([
      coordinator.request({ reason: 'stock-added', stockQuoteIds: ['1.600000'] }),
      coordinator.request({ reason: 'stock-added', stockQuoteIds: ['0.300001'] })
    ])

    expect(run).toHaveBeenCalledTimes(1)
    expect(first.scopes.size).toBe(0)
    expect([...first.stockQuoteIds]).toEqual(['1.600000', '0.300001'])
    expect(second).toBe(first)
  })
})
