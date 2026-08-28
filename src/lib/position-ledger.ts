import type {
  StockCurrency,
  StockMarket,
  StockPosition,
  TTradingAccount,
  TTrade
} from '../shared/types'
import { appendPortfolioLedgerEntries, withLedgerTradeRecords } from '../shared/types'
import { upsertTradeRecord } from './trade-records'

const EMPTY_FEES = {
  commission: 0,
  handling: 0,
  regulatory: 0,
  transfer: 0,
  stampDuty: 0
}

export interface PositionLedgerIdentity {
  quoteId: string
  code: string
  name: string
  market: StockMarket
  currency: StockCurrency
}

export function hasInitialPositionRecord(account: TTradingAccount | undefined): boolean {
  return account?.tradeRecords.some((record) => record.origin === 'opening-balance') ?? false
}

export function positionsMatch(
  left: StockPosition | undefined,
  right: StockPosition | undefined
): boolean {
  if (!left || !right) return left === right
  const ratesMatch =
    left.costExchangeRate === undefined || right.costExchangeRate === undefined
      ? left.costExchangeRate === right.costExchangeRate
      : Math.abs(left.costExchangeRate - right.costExchangeRate) < 0.000_001
  return (
    Math.abs(left.quantity - right.quantity) < 0.000_001 &&
    Math.abs(left.cost - right.cost) < 0.000_001 &&
    left.openedOn === right.openedOn &&
    ratesMatch
  )
}

export function createInitialPositionAccount(
  account: TTradingAccount | undefined,
  identity: PositionLedgerIdentity,
  position: StockPosition,
  marketDateTime: string
): TTradingAccount {
  const openedOn = position.openedOn ?? marketDateTime.slice(0, 10)
  const trade: TTrade = {
    id: `opening-balance:${identity.quoteId}`,
    side: 'buy',
    purpose: 'base',
    tradedAt: `${openedOn}T00:00`,
    price: position.cost,
    quantity: position.quantity,
    fees: EMPTY_FEES,
    market: identity.market,
    currency: identity.currency,
    marketDate: openedOn,
    exchangeRate: position.costExchangeRate ?? (identity.currency === 'CNY' ? 1 : undefined),
    exchangeRateDate: position.costExchangeRateDate,
    origin: 'opening-balance',
    note: '初始持仓'
  }
  const currentAccount: TTradingAccount = account ?? {
    ...identity,
    history: [],
    ledger: { schemaVersion: 1, entries: [] },
    tradeRecords: []
  }
  return withLedgerTradeRecords(
    { ...currentAccount, market: identity.market, currency: identity.currency },
    upsertTradeRecord(currentAccount.tradeRecords, trade)
  )
}

export function appendPositionAdjustment(
  account: TTradingAccount,
  previousPosition: StockPosition | undefined,
  nextPosition: StockPosition | undefined,
  occurredAt: string,
  recordedAt: string
): TTradingAccount {
  return appendPortfolioLedgerEntries(account, [
    {
      id: `position-adjustment:${crypto.randomUUID()}`,
      accountId: account.quoteId,
      quoteId: account.quoteId,
      occurredAt,
      marketDate: occurredAt.slice(0, 10),
      recordedAt,
      source: 'manual',
      currency: nextPosition?.currency ?? previousPosition?.currency ?? account.currency,
      exchangeRate: nextPosition?.costExchangeRate ?? previousPosition?.costExchangeRate,
      exchangeRateDate:
        nextPosition?.costExchangeRateDate ?? previousPosition?.costExchangeRateDate,
      note: '修改持仓',
      kind: 'positionAdjustment',
      quantityBefore: previousPosition?.quantity ?? 0,
      quantityAfter: nextPosition?.quantity ?? 0,
      costBefore: previousPosition?.cost ?? null,
      costAfter: nextPosition?.cost ?? null,
      openedOnBefore: previousPosition?.openedOn,
      openedOnAfter: nextPosition?.openedOn
    }
  ])
}
