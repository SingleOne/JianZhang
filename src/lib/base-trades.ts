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
  currency: StockCurrency,
  fallbackPosition?: StockPosition
): IndependentBaseTradeUpdate {
  const nextAccount = withLedgerTradeRecords(
    account,
    upsertTradeRecord(account.tradeRecords, {
      ...trade,
      purpose: 'base',
      allocations: undefined
    })
  )
  const previousReplay = calculatePortfolioLedgerPosition(account, market, currency)
  const replay = calculatePortfolioLedgerPosition(nextAccount, market, currency)
  if (
    replay.error &&
    previousReplay.error &&
    replay.errorEntryId !== `trade:${trade.id}` &&
    replay.errorEntryId === previousReplay.errorEntryId &&
    (replay.errorQuantity ?? 0) >= (previousReplay.errorQuantity ?? 0)
  ) {
    return { account: nextAccount, position: fallbackPosition, error: undefined }
  }
  return replay.error
    ? { account: nextAccount, error: replay.error }
    : { account: nextAccount, position: replay.position }
}

export function deleteIndependentBaseTrade(
  account: TTradingAccount,
  tradeId: string,
  market: StockMarket,
  currency: StockCurrency,
  fallbackPosition?: StockPosition
): IndependentBaseTradeUpdate {
  const nextAccount = withLedgerTradeRecords(
    account,
    account.tradeRecords.filter((trade) => trade.id !== tradeId)
  )
  const previousReplay = calculatePortfolioLedgerPosition(account, market, currency)
  const replay = calculatePortfolioLedgerPosition(nextAccount, market, currency)
  if (
    replay.error &&
    previousReplay.error &&
    replay.errorEntryId === previousReplay.errorEntryId &&
    (replay.errorQuantity ?? 0) >= (previousReplay.errorQuantity ?? 0)
  ) {
    return { account: nextAccount, position: fallbackPosition, error: undefined }
  }
  return replay.error
    ? { account: nextAccount, error: replay.error }
    : { account: nextAccount, position: replay.position }
}
