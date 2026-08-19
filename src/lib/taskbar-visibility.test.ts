import { describe, expect, it } from 'vitest'
import type { WatchStock } from '../shared/types'
import { getTaskbarVisibleStocks, shouldShowTaskbarTicker } from './taskbar-visibility'

function stock(quoteId: string, showInTaskbar: boolean): WatchStock {
  return {
    quoteId,
    code: quoteId,
    name: quoteId,
    marketLabel: '测试',
    showInTaskbar,
    isPriority: false,
    showRadarSignals: true
  }
}

describe('taskbar visibility', () => {
  const selected = stock('1.600000', true)
  const hidden = stock('1.603042', false)

  it('hides the ticker when the global taskbar setting is disabled', () => {
    expect(shouldShowTaskbarTicker(false, [selected])).toBe(false)
  })

  it('does not include stocks whose individual taskbar setting is disabled', () => {
    expect(getTaskbarVisibleStocks([selected, hidden])).toEqual([selected])
  })

  it('shows the ticker only when both levels of settings allow it', () => {
    expect(shouldShowTaskbarTicker(true, [hidden])).toBe(false)
    expect(shouldShowTaskbarTicker(true, [selected, hidden])).toBe(true)
  })
})
