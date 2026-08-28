import type {
  StockCurrency,
  StockMarket,
  StockPosition,
  TTradingAccount,
  TTrade
} from '../shared/types'
import { withLedgerTradeRecords } from '../shared/types'
import { calculatePortfolioLedgerPosition } from './portfolio-ledger'
import { upsertTradeRecord } from './trade-records'

export interface IndependentBaseTradeUpdate {
  account: TTradingAccount
  position?: StockPosition
  error?: string
}

export function upsertIndependentBaseTrade(
  account: TTradingAccount,
  trade: TTrade,
  market: StockMarket,
  currency: StockCurrency
): IndependentBaseTradeUpdate {
  const nextAccount = withLedgerTradeRecords(
    account,
    upsertTradeRecord(account.tradeRecords, {
      ...trade,
      purpose: 'base',
      allocations: undefined
    })
  )
  const replay = calculatePortfolioLedgerPosition(nextAccount, market, currency)
  return replay.error
    ? { account: nextAccount, error: replay.error }
    : { account: nextAccount, position: replay.position }
}

export function deleteIndependentBaseTrade(
  account: TTradingAccount,
  tradeId: string,
  market: StockMarket,
  currency: StockCurrency
): IndependentBaseTradeUpdate {
  const nextAccount = withLedgerTradeRecords(
    account,
    account.tradeRecords.filter((trade) => trade.id !== tradeId)
  )
  const replay = calculatePortfolioLedgerPosition(nextAccount, market, currency)
  return replay.error
    ? { account: nextAccount, error: replay.error }
    : { account: nextAccount, position: replay.position }
}
