import { useAppData } from '../lib/data-center/hooks'
import { selectPortfolio } from '../lib/data-center/portfolio-selectors'
import { MARKET_INDEX_OPTIONS, type AppState } from '../shared/types'
import { formatMoneyProfit, formatPercent, formatPrice, formatUpdateTime } from '../lib/format'
import { AnimatedNumber } from './AnimatedNumber'

function directionClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function cardDirectionClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-card-flat'
  return value > 0 ? 'is-card-up' : 'is-card-down'
}

export function MarketIndexSummary() {
  const marketIndexQuotes = useAppData(
    (snapshot) =>
      MARKET_INDEX_OPTIONS.filter((index) =>
        snapshot.state.settings.marketIndexIds.includes(index.id)
      ).map((index) => ({ index, quote: snapshot.quotesById.get(index.quoteId) })),
    (a, b) =>
      a.length === b.length &&
      a.every((item, i) => item.index === b[i].index && item.quote === b[i].quote)
  )
  return (
    <>
      {marketIndexQuotes.length > 0 ? (
        <div className="market-index-summary panel-market-index-summary" aria-label="大盘指数行情">
          {marketIndexQuotes.map(({ index, quote }) => (
            <span
              className={`market-index-card ${cardDirectionClass(quote?.changePercent)}`}
              title={`${index.name} ${formatPrice(quote?.latest)} ${formatPercent(quote?.changePercent)}`}
              key={index.id}
            >
              <small>{index.name}</small>
              <strong>{formatPrice(quote?.latest)}</strong>
              <em className={directionClass(quote?.changePercent)}>
                {formatPercent(quote?.changePercent)}
              </em>
            </span>
          ))}
        </div>
      ) : null}
    </>
  )
}
export function PortfolioSummaryCards({ state }: { state: AppState }) {
  const portfolioSummary = useAppData((snapshot) => selectPortfolio(snapshot, state).summary)
  return (
    <div className="portfolio-summary" aria-label="全部持仓收益汇总">
      <span className={cardDirectionClass(portfolioSummary.todayProfit)}>
        <small>今日总收益</small>
        <strong className={directionClass(portfolioSummary.todayProfit)}>
          <AnimatedNumber
            value={portfolioSummary.todayProfit}
            formattedValue={formatMoneyProfit(portfolioSummary.todayProfit, 'CNY')}
          />
        </strong>
        <em className={directionClass(portfolioSummary.todayProfitPercent)}>
          {formatPercent(portfolioSummary.todayProfitPercent)}
        </em>
      </span>
      <span className={cardDirectionClass(portfolioSummary.totalProfit)}>
        <small>持仓收益</small>
        <strong className={directionClass(portfolioSummary.totalProfit)}>
          <AnimatedNumber
            value={portfolioSummary.totalProfit}
            formattedValue={formatMoneyProfit(portfolioSummary.totalProfit, 'CNY')}
          />
        </strong>
        <em className={directionClass(portfolioSummary.profitPercent)}>
          {formatPercent(portfolioSummary.profitPercent)}
        </em>
      </span>
    </div>
  )
}
export function PositionCount() {
  const count = useAppData(
    (snapshot) => snapshot.state.watchlist.filter((stock) => stock.position).length
  )
  return <>{count}</>
}
export function QuoteUpdateStatus({ error }: { error: string }) {
  const lastUpdated = useAppData((snapshot) =>
    snapshot.quotes.reduce<string | undefined>((latest, quote) => {
      const time = quote.dataAt ?? quote.updatedAt
      return !latest || time > latest ? time : latest
    }, undefined)
  )
  return <>{error ? '行情连接异常，保留最近数据' : '最近更新 ' + formatUpdateTime(lastUpdated)}</>
}
