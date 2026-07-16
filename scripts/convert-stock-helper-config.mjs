import { readFileSync, writeFileSync } from 'node:fs'

const [sourcePath, targetPath] = process.argv.slice(2)
if (!sourcePath || !targetPath) {
  throw new Error('用法：node scripts/convert-stock-helper-config.mjs <原配置.json> <见涨配置.json>')
}

const source = JSON.parse(readFileSync(sourcePath, 'utf8'))
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const allStocks = source.stockGroup.flatMap((group) => group.data)
const supportedTypes = new Set(['沪A', '深A', '科创板'])
const supportedStocks = allStocks.filter((stock) => supportedTypes.has(stock.StockType))
const skippedStocks = allStocks
  .filter((stock) => !supportedTypes.has(stock.StockType))
  .map((stock) => ({ name: stock.name, code: stock.code, type: stock.StockType }))

const today = new Date()
const todayKey = [today.getFullYear(), today.getMonth() + 1, today.getDate()]
  .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
  .join('-')

const watchlist = supportedStocks.map((stock) => {
  const quantity = Number(stock.num)
  const cost = Number(stock.initPrice)
  const openedOn = typeof stock.isTodybuy === 'string' ? stock.isTodybuy : undefined
  const position = quantity > 0 && cost > 0
    ? { quantity, cost, openedToday: openedOn === todayKey, ...(openedOn ? { openedOn } : {}) }
    : undefined

  return {
    code: stock.code,
    name: stock.name,
    quoteId: `${stock.market}.${stock.code}`,
    marketLabel: stock.StockType,
    showInTaskbar: false,
    isPriority: Boolean(position),
    showRadarSignals: true,
    ...(position ? { position } : {})
  }
})

const document = {
  format: 'jianzhang-config',
  formatVersion: 1,
  applicationVersion: packageJson.version,
  exportedAt: new Date().toISOString(),
  state: {
    watchlist,
    settings: {
      priorityRefreshSeconds: 5,
      regularRefreshSeconds: 10,
      startWithWindows: false,
      minimizeToTray: true,
      showTaskbarTicker: true,
      taskbarPositionPercent: 0
    },
    columnOrder: [
      'stock', 'latest', 'changePercent', 'open', 'high', 'low', 'amount',
      'radar', 'positionQuantity', 'cost', 'marketValue', 'todayProfit',
      'todayProfitPercent', 'totalProfit', 'profitPercent', 'operation'
    ]
  },
  source: {
    application: '股票基金助手',
    version: source.version,
    skippedStocks
  }
}

writeFileSync(targetPath, JSON.stringify(document, null, 2), 'utf8')
console.log(`已转换 ${watchlist.length} 只 A 股，跳过 ${skippedStocks.length} 个不兼容条目。`)
