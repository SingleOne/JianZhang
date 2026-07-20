import type { FundsFlowResult, StockQuote } from '../../../../shared/types'
import type { IndicatorValue } from '../../shared/types'
import { directionState, indicator } from './shared'

export interface RelativeStrengthInput {
  quote: StockQuote
  marketIndexQuote?: StockQuote
  fundsFlow: FundsFlowResult | null
}

export interface RelativeStrengthResult {
  values: IndicatorValue[]
  fundsDirection: number | null
  relativeStrength: number | null
}

export function calculateRelativeStrengthIndicators(
  input: RelativeStrengthInput,
  calculatedAt: string
): RelativeStrengthResult {
  const sectorChange = input.quote.sector?.changePercent ?? null
  const stockChange = input.quote.changePercent
  const sectorRelative = stockChange !== null && sectorChange !== null ? stockChange - sectorChange : null
  const indexChange = input.marketIndexQuote?.changePercent ?? null
  const indexRelative = stockChange !== null && indexChange !== null ? stockChange - indexChange : null
  const funds = input.fundsFlow?.points ?? []
  const latestFund = funds.at(-1)?.main ?? null
  const previousFund = funds.at(-6)?.main ?? null
  const fundsSlope = latestFund !== null && previousFund !== null ? latestFund - previousFund : null
  const relativeStrength = sectorRelative ?? indexRelative
  return {
    relativeStrength,
    fundsDirection: latestFund,
    values: [
      indicator('relative-sector', '相对行业强弱', sectorRelative, 'percent', calculatedAt, '行情/行业', directionState(sectorRelative)),
      indicator('relative-index', '相对大盘强弱', indexRelative, 'percent', calculatedAt, '行情/大盘', directionState(indexRelative)),
      indicator('turnover-rate', '换手率', input.quote.turnoverRate, 'percent', calculatedAt, '行情'),
      indicator('funds-main-net', '主力资金净流入', latestFund, 'amount', calculatedAt, '资金流', directionState(latestFund)),
      indicator('funds-main-slope', '主力资金短窗变化', fundsSlope, 'amount', calculatedAt, '资金流', directionState(fundsSlope))
    ]
  }
}
