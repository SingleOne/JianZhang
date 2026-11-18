import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS, type AppState, type StockQuote } from '../shared/types'
import { getMenuBarPresentation } from './menu-bar'

function state(): AppState {
  return {
    settings: { ...DEFAULT_APP_SETTINGS, showTaskbarTicker: true, menuBarDisplayMode: 'stock' },
    watchlist: [{ quoteId: '1.600519', name: '贵州茅台', showInTaskbar: true }],
    stockTradingBooks: {}
  } as AppState
}

function quote(changePercent = 3.96): StockQuote {
  return {
    quoteId: '1.600519',
    code: '600519',
    name: '贵州茅台',
    latest: 1247.52,
    changePercent,
    previousClose: 1200,
    dataAt: '2026-07-31T02:00:00.000Z'
  } as StockQuote
}

describe('menu bar presentation', () => {
  it.each([
    ['2026-07-31T02:00:00.000Z', '实时'],
    ['2026-07-31T08:00:00.000Z', '休市'],
    ['2026-07-31T02:10:00.000Z', '已过期']
  ])('omits market status from the title at %s but retains it in the tooltip', (now, status) => {
    const presentation = getMenuBarPresentation(state(), [quote()], 0, new Date(now))
    expect(presentation.title).toBe('贵州茅台 \u001b[31m1247.52\u001b[0m \u001b[31m+3.96%\u001b[0m')
    expect(presentation.tooltip).toContain(` · ${status}`)
    expect(presentation.stockTitles).toEqual([
      {
        quoteId: '1.600519',
        label: '贵州茅台',
        values: '\u001b[31m1247.52\u001b[0m \u001b[31m+3.96%\u001b[0m'
      }
    ])
  })

  it('keeps missing quotes neutral and moves their status to the tooltip', () => {
    const presentation = getMenuBarPresentation(state(), [], 0)
    expect(presentation.title).toBe('贵州茅台 -- --')
    expect(presentation.tooltip).toContain(' · 时间未知')
  })

  it.each([
    [-3.96, '\u001b[32m1247.52\u001b[0m \u001b[32m-3.96%\u001b[0m'],
    [0, '1247.52 +0.00%']
  ])(
    'retains red/green/neutral values independently of the name for change %s',
    (change, values) => {
      const presentation = getMenuBarPresentation(state(), [quote(change)], 0)
      expect(presentation.stockTitles[0]).toMatchObject({ label: '贵州茅台', values })
    }
  )

  it.each([
    ['2026-07-31T02:10:00.000Z', [quote()], '已过期'],
    ['2026-07-31T08:00:00.000Z', [quote()], '休市'],
    ['2026-07-31T02:00:00.000Z', [], '时间未知']
  ] as const)('keeps profit mode free of market status at %s', (now, quotes, status) => {
    const current = state()
    current.settings.menuBarDisplayMode = 'profit'
    const presentation = getMenuBarPresentation(current, quotes, 0, new Date(now))
    expect(presentation.title).toBe('今日 --')
    expect(presentation.tooltip).toContain(` · ${status}`)
  })

  it('preserves profit completeness in the tooltip without appending it to the title', () => {
    const current = state()
    current.settings.menuBarDisplayMode = 'profit'
    current.watchlist[0].position = { quantity: 100, cost: 1000, openedToday: false }
    const presentation = getMenuBarPresentation(current, [], 0)
    expect(presentation.title).toBe('今日 --')
    expect(presentation.tooltip).toContain('所选股票今日收益合计（人民币） · 不完整')
  })
})
