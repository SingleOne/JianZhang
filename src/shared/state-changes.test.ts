import { describe, expect, it } from 'vitest'
import {
  applyAppStateUpdate,
  applyStatePatch,
  createAppStateUpdate,
  createStatePatch,
  reuseUnchangedState
} from './state-changes'
import { DEFAULT_APP_SETTINGS, DEFAULT_WATCHLIST_COLUMN_ORDER, type AppState } from './types'

function state(): AppState {
  return {
    revision: 1,
    watchlist: [],
    watchlistGroups: [],
    stockTrackingProfiles: {},
    settings: structuredClone(DEFAULT_APP_SETTINGS),
    columnOrder: [...DEFAULT_WATCHLIST_COLUMN_ORDER],
    stockTradingBooks: {},
    corporateActionApplications: {}
  }
}

describe('incremental state changes', () => {
  it('does not visit unchanged branches when a preference changes', () => {
    const before = state()
    Object.defineProperty(before.stockTrackingProfiles, 'unreadHistory', {
      enumerable: true,
      get: () => {
        throw new Error('Unchanged history must not be traversed')
      }
    })
    const next = {
      ...before,
      revision: 2,
      settings: { ...before.settings, theme: 'dark' as const }
    }
    const update = createAppStateUpdate(before, next)
    const result = applyAppStateUpdate(before, update)
    expect(result.settings.theme).toBe('dark')
    expect(result.stockTrackingProfiles).toBe(before.stockTrackingProfiles)
    expect(result.stockTradingBooks).toBe(before.stockTradingBooks)
    expect(JSON.stringify(update)).not.toContain('stockTrackingProfiles')
  })

  it('sends only appended history entries and preserves the existing prefix', () => {
    const first = { tradingDate: '2026-10-28', metrics: { close: 10 } }
    const second = { tradingDate: '2026-10-29', metrics: { close: 11 } }
    const before = { history: [first] }
    const next = { history: [first, second] }
    const patch = createStatePatch(before, next)
    expect(JSON.stringify(patch)).not.toContain('2026-10-28')
    const result = applyStatePatch(before, patch)
    expect(result).toEqual(next)
    expect(result.history[0]).toBe(first)
  })

  it('applies removals, explicit undefined values and array reordering', () => {
    const before = { optional: 12, records: [{ id: 'a' }, { id: 'b' }], removed: true }
    const next = { optional: undefined, records: [{ id: 'b' }] }
    const result = applyStatePatch(before, createStatePatch(before, next))
    expect(result).toEqual(next)
    expect(Object.hasOwn(result, 'optional')).toBe(true)
    expect(Object.hasOwn(result, 'removed')).toBe(false)
  })

  it('recognizes equal copied values and reuses their existing references', () => {
    const before = { history: [{ close: 10 }], settings: { enabled: true } }
    expect(createStatePatch(before, structuredClone(before))).toBeNull()
    expect(reuseUnchangedState(before, structuredClone(before))).toBe(before)
  })

  it('rejects a delta against a stale base revision', () => {
    const before = state()
    const update = createAppStateUpdate(before, { ...before, revision: 2 })
    expect(() => applyAppStateUpdate({ ...before, revision: 3 }, update)).toThrow(
      '数据已在后台更新'
    )
  })

  it('does not accept revision writes inside the state patch', () => {
    const before = state()
    expect(() =>
      applyAppStateUpdate(before, {
        baseRevision: 1,
        revision: 2,
        patch: { kind: 'object', fields: { revision: { kind: 'value', value: 100 } }, removed: [] }
      })
    ).toThrow('状态变更请求无效')
  })
})
