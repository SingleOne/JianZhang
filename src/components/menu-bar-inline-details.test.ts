import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS, type AppState, type StockQuote } from '../shared/types'
import { getTraySummaryStocks } from '../lib/tray-summary'
import { MenuBarStockRow } from './MenuBarStockRow'
import { MiniPriceSparkline, StockQuoteDetails } from './TaskbarStockTooltip'

vi.mock('../lib/api', () => ({ stockApi: {}, initialState: {} }))

const state = {
  settings: DEFAULT_APP_SETTINGS,
  watchlist: [
    {
      quoteId: '1.600519',
      code: '600519',
      name: '贵州茅台',
      marketLabel: '沪A',
      showInTaskbar: true
    },
    {
      quoteId: '0.300750',
      code: '300750',
      name: '宁德时代',
      marketLabel: '深A',
      showInTaskbar: true
    }
  ],
  stockTradingBooks: {}
} as AppState
const quotes = [
  {
    quoteId: '1.600519',
    latest: 1247.52,
    change: 47.52,
    changePercent: 3.96,
    open: 1200,
    high: 1250,
    low: 1190,
    turnoverRate: 0.28,
    sector: { code: 'BK0896', name: '白酒', quoteId: '90.BK0896', changePercent: 0.67 },
    dataAt: '2026-10-21T15:00:00+08:00'
  }
] as StockQuote[]
const summaries = getTraySummaryStocks(state, quotes)

function details(index: number, embedded: boolean) {
  return createElement(StockQuoteDetails, {
    quoteId: summaries[index].stock.quoteId,
    state,
    quotes,
    embedded
  })
}

function row(index: number, expanded: boolean) {
  return createElement(
    MenuBarStockRow,
    {
      key: summaries[index].stock.quoteId,
      summary: summaries[index],
      status: 'closed',
      expanded,
      onToggle: () => {}
    },
    details(index, true)
  )
}

describe('inline menu bar stock details', () => {
  it('uses a full-row disclosure button and does not mount collapsed details', () => {
    const html = renderToStaticMarkup(row(0, false))
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('hidden=""')
    expect(html).toContain('贵州茅台')
    expect(html).toContain('1247.52')
    expect(html).not.toContain('最近15分钟')
    expect(html).not.toContain('<article')
    expect(html.match(/<button/g)).toHaveLength(1)
  })

  it('shows complete market and position information inside the expanded row', () => {
    const html = renderToStaticMarkup(row(0, true))
    expect(html).toContain('aria-expanded="true"')
    expect(html).not.toContain('hidden=""')
    for (const label of [
      '今开',
      '最高',
      '最低',
      '换手',
      '最近15分钟',
      '五档数量',
      '持仓',
      '市值',
      '收益率',
      '在主窗口查看'
    ]) {
      expect(html).toContain(label)
    }
    expect(html.match(/贵州茅台<\//g)).toHaveLength(1)
    expect(html).toContain('menu-bar-stock-market">沪A')
    expect(html).toContain('menu-bar-stock-time')
    expect(html).toContain('1,247.52')
    expect(html).toContain('taskbar-tooltip-inline-market')
    expect(html).toContain('is-expanded-chart')
    expect(html).toContain('<dd>0.28%</dd>')
    expect(html).not.toContain('taskbar-stock-tooltip-shell')
  })

  it('keeps unique disclosure/region relationships when only one row is expanded', () => {
    const html = renderToStaticMarkup(createElement('div', null, row(0, false), row(1, true)))
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1)
    expect(html.match(/<article/g)).toHaveLength(1)
    const ids = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((match) => match[1])
    expect(new Set(ids).size).toBe(2)
    ids.forEach((id) => expect(html).toContain(`id="${id}"`))
  })

  it('retains the standalone Windows identity and price header', () => {
    const standalone = renderToStaticMarkup(details(0, false))
    const embedded = renderToStaticMarkup(details(0, true))
    expect(standalone).toContain('贵州茅台')
    expect(standalone).toContain('taskbar-tooltip-price-row')
    expect(standalone).toContain('taskbar-tooltip-sector" title="白酒"')
    expect(standalone).toContain('<b class="is-up">+0.67%</b>')
    expect(standalone.split('</header>')[0]).not.toContain('taskbar-tooltip-sector')
    expect(standalone).toMatch(
      /taskbar-tooltip-price-change[\s\S]*\+3\.96%[\s\S]*taskbar-tooltip-sector/
    )
    expect(standalone).not.toContain('在主窗口查看')
    expect(embedded).not.toContain('贵州茅台')
    expect(embedded).not.toContain('<header')
    expect(embedded).toContain('taskbar-tooltip-price-row')
    expect(embedded).toContain('taskbar-tooltip-sector" title="白酒"')
    expect(embedded).toContain('<b class="is-up">+0.67%</b>')
    expect(embedded).toMatch(
      /taskbar-tooltip-price-change[\s\S]*\+3\.96%[\s\S]*taskbar-tooltip-sector/
    )
    expect(embedded).toContain('1,247.52')
    expect(embedded).toContain('taskbar-tooltip-today-label">今日')
    expect(standalone).toContain('taskbar-tooltip-inline-market')
    expect(standalone).toContain('is-expanded-chart')
    expect(standalone).toContain('taskbar-tooltip-today-label">今日')
  })
})

describe('expanded inline price chart', () => {
  it('uses the supplied prices for an accessible area chart without compact extrema labels', () => {
    const html = renderToStaticMarkup(
      createElement(MiniPriceSparkline, { prices: [10, 10.5, 10.2, 11], expanded: true })
    )
    expect(html).toContain('viewBox="0 0 360 88"')
    expect(html).toContain('最近15分钟价格从 10 变化至 11，最高 11，最低 10')
    expect(html).toContain('<linearGradient')
    expect(html).toContain('M 2.00 86.00 L 120.67 44.00 L 239.33 69.20 L 358.00 2.00')
    expect(html).not.toContain('<circle')
    expect(html).not.toContain('taskbar-tooltip-stacked-values')
  })

  it('draws stable horizontal lines for single-point or unchanged prices', () => {
    for (const prices of [[10], [10, 10, 10]]) {
      const html = renderToStaticMarkup(
        createElement(MiniPriceSparkline, { prices, expanded: true })
      )
      expect(html).toContain('is-flat')
      expect(html).toContain('<path')
      expect(html).not.toMatch(/NaN|Infinity/)
    }
  })

  it('keeps missing chart data empty instead of drawing a fabricated curve', () => {
    const html = renderToStaticMarkup(
      createElement(MiniPriceSparkline, { prices: [], expanded: true })
    )
    expect(html).toContain('<dd>--</dd>')
    expect(html).not.toContain('<svg')
  })
})
