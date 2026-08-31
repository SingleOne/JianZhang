import { calculatePortfolioLedgerPosition } from '../../src/lib/portfolio-ledger'
import {
  appendPositionAdjustment,
  removePositionRecordEntries
} from '../../src/lib/position-ledger'
import { stockMarketIdentity } from '../../src/shared/stock-market'
import type { AppState, StockPosition, TTradeRecord, TTradingAccount } from '../../src/shared/types'

interface OpeningBalanceFingerprint {
  quoteId: string
  tradedAt: string
  price: number
  quantity: number
}

const CHANGAN_QUOTE_ID = '0.000625'
const CREC_QUOTE_ID = '1.601390'
const CREC_PERFORMANCE_RESET_ADJUSTMENT_ID =
  'position-adjustment:ac1c7447-57b4-4724-9d5d-7f2932f14396'

const CORRUPTED_OPENING_BALANCES: readonly OpeningBalanceFingerprint[] = [
  {
    quoteId: CHANGAN_QUOTE_ID,
    tradedAt: '2026-07-16T00:00',
    price: 7.8245,
    quantity: 500
  },
  {
    quoteId: CREC_QUOTE_ID,
    tradedAt: '2026-07-01T00:00',
    price: -0.9383,
    quantity: 100
  }
]

const CORRUPTED_POSITIONS: Record<string, Pick<StockPosition, 'quantity' | 'cost' | 'openedOn'>> = {
  [CHANGAN_QUOTE_ID]: { quantity: 1_000, cost: 7.4287, openedOn: '2026-07-16' },
  [CREC_QUOTE_ID]: { quantity: 100, cost: -0.9383, openedOn: '2026-07-01' }
}

const CORRUPTED_ADJUSTMENTS: Record<string, number> = {
  [CHANGAN_QUOTE_ID]: 362.25,
  [CREC_QUOTE_ID]: -1_049.79
}

const REPAIRED_POSITIONS: Record<string, StockPosition> = {
  [CHANGAN_QUOTE_ID]: {
    quantity: 500,
    cost: 7.8245,
    openedToday: false,
    openedOn: '2026-07-16',
    currency: 'CNY',
    costExchangeRate: 1,
    costExchangeRateDate: '2026-07-16'
  },
  [CREC_QUOTE_ID]: {
    quantity: 100,
    cost: -0.9383,
    openedToday: false,
    openedOn: '2026-07-01',
    currency: 'CNY',
    costExchangeRate: 1,
    costExchangeRateDate: '2026-07-01'
  }
}

function isCorruptedOpeningBalance(
  record: TTradeRecord,
  fingerprint: OpeningBalanceFingerprint
): boolean {
  return (
    record.id === `opening-balance:${fingerprint.quoteId}` &&
    record.origin === 'opening-balance' &&
    record.side === 'buy' &&
    record.purpose === 'base' &&
    record.tradedAt === fingerprint.tradedAt &&
    record.price === fingerprint.price &&
    record.quantity === fingerprint.quantity &&
    record.note === '初始持仓'
  )
}

function hasCorruptedPosition(state: AppState, quoteId: string): boolean {
  const position = state.watchlist.find((stock) => stock.quoteId === quoteId)?.position
  const fingerprint = CORRUPTED_POSITIONS[quoteId]
  return (
    position?.quantity === fingerprint.quantity &&
    position.cost === fingerprint.cost &&
    position.openedOn === fingerprint.openedOn
  )
}

function hasKnownCorruption(state: AppState): boolean {
  return CORRUPTED_OPENING_BALANCES.every((fingerprint) => {
    const account = state.tTradingAccounts[fingerprint.quoteId]
    return (
      account?.tradeRecords.some((record) => isCorruptedOpeningBalance(record, fingerprint)) ===
        true &&
      hasCorruptedPosition(state, fingerprint.quoteId) &&
      state.portfolioPerformanceAdjustments?.[fingerprint.quoteId] ===
        CORRUPTED_ADJUSTMENTS[fingerprint.quoteId]
    )
  })
}

function positionsMatchForRepair(left: StockPosition | undefined, right: StockPosition): boolean {
  return (
    left !== undefined &&
    Math.abs(left.quantity - right.quantity) < 0.000_001 &&
    Math.abs(left.cost - right.cost) < 0.000_001 &&
    left.openedOn === right.openedOn
  )
}

function removeOpeningBalance(
  account: TTradingAccount,
  fingerprint: OpeningBalanceFingerprint
): TTradingAccount {
  const entryIds = new Set(
    account.ledger.entries.flatMap((entry) =>
      entry.kind === 'trade' && isCorruptedOpeningBalance(entry.record, fingerprint)
        ? [entry.id]
        : []
    )
  )
  return removePositionRecordEntries(account, entryIds)
}

function markKnownCrecPerformanceReset(state: AppState): AppState {
  const account = state.tTradingAccounts[CREC_QUOTE_ID]
  if (!account) return state

  let changed = false
  const entries = account.ledger.entries.map((entry) => {
    if (
      entry.kind !== 'positionAdjustment' ||
      entry.id !== CREC_PERFORMANCE_RESET_ADJUSTMENT_ID ||
      entry.occurredAt !== '2026-08-30T21:56:57.908' ||
      entry.recordedAt !== '2026-08-30T13:56:57.908Z' ||
      entry.quantityBefore !== 200 ||
      entry.quantityAfter !== 100 ||
      entry.costBefore !== 4.348_537_067_646_157 ||
      entry.costAfter !== -0.9383 ||
      entry.resetsPerformance
    ) {
      return entry
    }
    changed = true
    return { ...entry, resetsPerformance: true }
  })
  if (!changed) return state

  return {
    ...state,
    tTradingAccounts: {
      ...state.tTradingAccounts,
      [CREC_QUOTE_ID]: {
        ...account,
        ledger: { ...account.ledger, entries }
      }
    }
  }
}

/**
 * Repairs the exact stale portfolio snapshot written to the host profile and independently
 * upgrades the known CREC broker-cost calibration to a performance reset checkpoint.
 */
export function repairKnownPortfolioDataCorruption(state: AppState, now: Date): AppState {
  if (!hasKnownCorruption(state)) return markKnownCrecPerformanceReset(state)

  const watchlist = state.watchlist.map((stock) => {
    const repairedPosition = REPAIRED_POSITIONS[stock.quoteId]
    return repairedPosition ? { ...stock, position: repairedPosition } : stock
  })
  const tTradingAccounts = { ...state.tTradingAccounts }

  for (const fingerprint of CORRUPTED_OPENING_BALANCES) {
    const account = tTradingAccounts[fingerprint.quoteId]
    const repairedPosition = REPAIRED_POSITIONS[fingerprint.quoteId]
    let repairedAccount = removeOpeningBalance(account, fingerprint)
    const identity = stockMarketIdentity(fingerprint.quoteId)
    const replay = calculatePortfolioLedgerPosition(
      repairedAccount,
      identity.market,
      identity.currency
    )

    if (!replay.error && !positionsMatchForRepair(replay.position, repairedPosition)) {
      const recordedAt = now.toISOString()
      repairedAccount = appendPositionAdjustment(
        repairedAccount,
        replay.position,
        repairedPosition,
        recordedAt,
        recordedAt,
        true
      )
    }
    tTradingAccounts[fingerprint.quoteId] = repairedAccount
  }

  return markKnownCrecPerformanceReset({
    ...state,
    watchlist,
    tTradingAccounts,
    portfolioPerformanceAdjustments: {}
  })
}
