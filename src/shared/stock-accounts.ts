import { currencyForMarket, marketFromQuoteId, STOCK_MARKET_LABELS } from './stock-market'
import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  normalizeTTradingAccounts,
  normalizeActiveTTradingBatch,
  tradeRecordsFromLedger,
  synchronizeWatchlistGroupMemberships,
  type AppState,
  type SecuritiesAccount,
  type SecuritiesAccounts,
  type StockMarket,
  type StockPosition,
  type StockTradingBook,
  type StockTradingBooks,
  type TTradingAccount,
  type TTradingAccounts,
  type CorporateActionRecords
} from './types'
import { getBatchTrades } from '../lib/trade-records'
import { getStockTBatches } from './stock-t-batches'
import { reconcileStockTBatches } from '../lib/stock-t-trading'

export const ACCOUNT_MARKETS = ['CN', 'HK', 'US'] as const

export function defaultAccountId(market: StockMarket): string {
  return `default:${market}`
}

export function createDefaultAccounts(settings = DEFAULT_APP_SETTINGS): SecuritiesAccounts {
  return Object.fromEntries(
    ACCOUNT_MARKETS.map((market) => {
      const id = defaultAccountId(market)
      return [
        id,
        {
          id,
          market,
          name: `${STOCK_MARKET_LABELS[market]}默认账户`,
          enabled: true,
          isSystemDefault: false,
          feeSettings:
            market === 'CN'
              ? { market, settings: structuredClone(settings.tTradingFees) }
              : market === 'HK'
                ? { market, settings: structuredClone(settings.marketTradeFees.HK) }
                : { market, settings: structuredClone(settings.marketTradeFees.US) }
        } satisfies SecuritiesAccount
      ]
    })
  )
}

export function listStockAccountBooks(
  book: StockTradingBook | TTradingAccount | undefined
): TTradingAccount[] {
  if (!book) return []
  return 'accounts' in book ? Object.values(book.accounts) : [book]
}

export function getStockAccountBook(
  books: StockTradingBooks,
  quoteId: string,
  accountId: string
): TTradingAccount | undefined {
  return listStockAccountBooks(books[quoteId]).find((book) => book.accountId === accountId)
}

export function flattenStockAccountBooks(books: StockTradingBooks): TTradingAccounts {
  return Object.fromEntries(
    Object.values(books).flatMap((book) =>
      listStockAccountBooks(book).map((account) => [
        `${account.quoteId}::${account.accountId ?? 'legacy'}`,
        account
      ])
    )
  )
}

export function listAccountsForMarket(
  accounts: SecuritiesAccounts | undefined,
  market: StockMarket,
  includeDisabled = false
): SecuritiesAccount[] {
  return Object.values(accounts ?? createDefaultAccounts())
    .filter((account) => account.market === market && (includeDisabled || account.enabled))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

export function resolveAccountSelection(
  state: Pick<AppState, 'settings' | 'securitiesAccounts'>,
  market: StockMarket,
  preferredId?: string
): string {
  const accounts = state.securitiesAccounts ?? createDefaultAccounts(state.settings)
  for (const id of [
    preferredId,
    state.settings.lastUsedAccountIdByMarket?.[market],
    defaultAccountId(market)
  ]) {
    if (id && accounts[id]?.enabled && accounts[id].market === market) return id
  }
  return listAccountsForMarket(accounts, market)[0]?.id ?? ''
}

export function accountFeeSettings(
  account: SecuritiesAccount | undefined,
  settings = DEFAULT_APP_SETTINGS
) {
  return {
    tTradingFees:
      account?.feeSettings.market === 'CN' ? account.feeSettings.settings : settings.tTradingFees,
    marketTradeFees: {
      HK:
        account?.feeSettings.market === 'HK'
          ? account.feeSettings.settings
          : settings.marketTradeFees.HK,
      US:
        account?.feeSettings.market === 'US'
          ? account.feeSettings.settings
          : settings.marketTradeFees.US
    }
  }
}

export function aggregateAccountPositions(
  books: readonly TTradingAccount[]
): StockPosition | undefined {
  const positions = books.flatMap((book) =>
    book.position && book.position.quantity > 0 ? [book.position] : []
  )
  if (!positions.length) return undefined
  const quantity = positions.reduce((sum, p) => sum + p.quantity, 0)
  const costBasis = positions.reduce((sum, p) => sum + p.quantity * p.cost, 0)
  const completeRate = positions.every(
    (p) => p.currency === 'CNY' || p.costExchangeRate !== undefined
  )
  const cnyCost = positions.reduce(
    (sum, p) => sum + p.quantity * p.cost * (p.costExchangeRate ?? 1),
    0
  )
  const dates = positions.flatMap((p) => (p.openedOn ? [p.openedOn] : [])).sort()
  return {
    quantity,
    cost: costBasis / quantity,
    openedToday: positions.every((p) => p.openedToday),
    openedOn: dates[0],
    currency: positions[0].currency,
    costExchangeRate: completeRate && costBasis > 0 ? cnyCost / costBasis : undefined,
    costExchangeRateDate: positions
      .map((p) => p.costExchangeRateDate)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1)
  }
}

export function recordsForAccount(
  records: CorporateActionRecords,
  accountId: string
): CorporateActionRecords {
  return Object.fromEntries(
    Object.values(records)
      .filter((record) => record.accountId === accountId)
      .map((record) => [record.id, record])
  )
}

export function corporateApplicationKey(accountId: string, candidateId: string): string {
  return `${accountId}::${candidateId}`
}

export function normalizeAccountState(state: AppState): AppState {
  const settings = normalizeAppSettings(state.settings)
  const accounts = { ...(state.securitiesAccounts ?? createDefaultAccounts(settings)) }
  for (const [id, account] of Object.entries(accounts)) {
    accounts[id] = { ...account, isSystemDefault: false }
    if (!account.name.trim() || account.id !== id || account.feeSettings.market !== account.market)
      throw new Error('股票账户资料或市场不一致')
    if (
      Object.values(account.feeSettings.settings).some(
        (value) => typeof value === 'number' && (!Number.isFinite(value) || value < 0)
      )
    )
      throw new Error('账户费率必须为有效的非负数字')
  }
  const input = state.stockTradingBooks ?? state.tTradingAccounts ?? {}
  const stockTradingBooks: StockTradingBooks = {}
  const quoteIds = new Set([
    ...Object.keys(input),
    ...state.watchlist.filter((stock) => stock.position).map((stock) => stock.quoteId)
  ])
  for (const quoteId of quoteIds) {
    const stock = state.watchlist.find((item) => item.quoteId === quoteId)
    const source = input[quoteId]
    const legacy = !source || !('accounts' in source)
    const market =
      stock?.market ??
      (source && !('accounts' in source) ? source.market : undefined) ??
      marketFromQuoteId(quoteId)
    const oldAccount = source && !('accounts' in source) ? source : undefined
    const children =
      source && 'accounts' in source
        ? source.accounts
        : !source && state.portfolioSchemaVersion === 2
          ? {}
          : {
              [defaultAccountId(market)]: {
                quoteId,
                code: stock?.code ?? oldAccount?.code ?? quoteId,
                name: stock?.name ?? oldAccount?.name ?? quoteId,
                history: [],
                ledger: { schemaVersion: 1 as const, entries: [] },
                tradeRecords: [],
                ...oldAccount,
                position: stock?.position ?? oldAccount?.position,
                positionSnapshots: stock?.positionSnapshots ?? oldAccount?.positionSnapshots,
                performanceAdjustmentCny:
                  state.portfolioPerformanceAdjustments?.[quoteId] ??
                  oldAccount?.performanceAdjustmentCny
              }
            }
    const hasStockBatches = Boolean(source && 'accounts' in source && source.tBatches)
    const oldBatches = Object.entries(children).flatMap(([accountId, child]) =>
      [child.activeBatch, ...child.history]
        .filter((batch): batch is NonNullable<typeof batch> => Boolean(batch))
        .map((batch) => ({ ...batch, accountId }))
    )
    const batchIdCounts = new Map<string, number>()
    for (const batch of oldBatches)
      batchIdCounts.set(batch.id, (batchIdCounts.get(batch.id) ?? 0) + 1)
    const batchIdFor = (accountId: string, batchId: string) =>
      !hasStockBatches && (batchIdCounts.get(batchId) ?? 0) > 1
        ? `${accountId}:${batchId}`
        : batchId
    const normalized: TTradingAccounts = {}
    for (const [accountId, child] of Object.entries(children)) {
      const owner = accounts[accountId]
      if (!owner || owner.market !== market) throw new Error(`股票 ${quoteId} 的账户归属无效`)
      if (!legacy && (child.accountId !== accountId || child.quoteId !== quoteId))
        throw new Error('子账本账户或证券身份不一致')
      const ledger = {
        ...child.ledger,
        entries: child.ledger.entries.map((entry) => {
          if (
            !legacy &&
            (entry.accountId !== accountId ||
              entry.quoteId !== quoteId ||
              (entry.kind === 'trade' && entry.record.accountId !== accountId))
          )
            throw new Error('交易不能跨账户写入')
          const record =
            entry.kind === 'trade'
              ? {
                  ...entry.record,
                  accountId,
                  batchId: entry.record.batchId
                    ? batchIdFor(accountId, entry.record.batchId)
                    : undefined,
                  allocations: entry.record.allocations?.map((allocation) => ({
                    ...allocation,
                    batchId: allocation.batchId
                      ? batchIdFor(accountId, allocation.batchId)
                      : undefined
                  }))
                }
              : undefined
          return {
            ...entry,
            accountId,
            quoteId,
            ...(record ? { record } : {})
          }
        })
      }
      const bound = {
        ...child,
        accountId,
        accountName: owner.name,
        quoteId,
        market,
        currency: currencyForMarket(market),
        ledger,
        tradeRecords: tradeRecordsFromLedger(ledger),
        activeBatch: undefined,
        history: []
      }
      normalized[accountId] = normalizeTTradingAccounts({ [accountId]: bound })[accountId]
    }
    const parent: StockTradingBook = {
      quoteId,
      accounts: normalized,
      boardLotSize:
        source && 'accounts' in source
          ? (source.boardLotSize ??
            Object.values(children).find((child) => child.boardLotSize)?.boardLotSize)
          : oldAccount?.boardLotSize
    }
    const batches = hasStockBatches
      ? getStockTBatches(source)
      : oldBatches.map((batch) => ({ ...batch, id: batchIdFor(batch.accountId, batch.id) }))
    parent.tBatches = batches.map((batch) => {
      const legacyCalibrationProfit =
        batch.legacyCalibrationProfit ??
        (batch.costCalibrations?.length
          ? 0
          : batch.settlement
            ? batch.settlement.finalProfit - batch.settlement.ledgerProfit
            : 0)
      const normalizedBatch = { ...batch, legacyCalibrationProfit }
      return batch.settlement
        ? normalizedBatch
        : normalizeActiveTTradingBatch(normalizedBatch, getBatchTrades(parent, batch), market)
    })
    stockTradingBooks[quoteId] = parent
  }
  const applications: CorporateActionRecords = {}
  for (const record of Object.values(
    state.corporateActionApplications ?? state.corporateActionRecords ?? {}
  )) {
    const accountId =
      record.accountId ?? defaultAccountId(record.market ?? marketFromQuoteId(record.quoteId))
    if (
      !accounts[accountId] ||
      accounts[accountId].market !== (record.market ?? marketFromQuoteId(record.quoteId))
    )
      throw new Error('公司行动账户归属无效')
    applications[corporateApplicationKey(accountId, record.id)] = { ...record, accountId }
  }
  const lastUsedAccountIdByMarket = { ...settings.lastUsedAccountIdByMarket }
  for (const market of ACCOUNT_MARKETS) {
    const id = lastUsedAccountIdByMarket[market]
    if (!id || !accounts[id]?.enabled || accounts[id].market !== market) {
      const fallback = listAccountsForMarket(accounts, market)[0]?.id
      if (fallback) lastUsedAccountIdByMarket[market] = fallback
      else delete lastUsedAccountIdByMarket[market]
    }
  }
  const watchlist = state.watchlist.map((stock) => {
    const { positionSnapshots: _legacySnapshots, ...metadata } = stock
    return {
      ...metadata,
      position: aggregateAccountPositions(listStockAccountBooks(stockTradingBooks[stock.quoteId]))
    }
  })
  const { tTradingAccounts: _oldBooks, corporateActionRecords: _oldRecords, ...rest } = state
  return {
    ...rest,
    portfolioSchemaVersion: 2,
    securitiesAccounts: accounts,
    stockTradingBooks,
    corporateActionApplications: applications,
    portfolioPerformanceAdjustments: {},
    settings: { ...settings, lastUsedAccountIdByMarket },
    watchlist: synchronizeWatchlistGroupMemberships(
      watchlist,
      state.watchlistGroups,
      state.stockTrackingProfiles
    )
  }
}

export function upsertStockAccount(
  state: AppState,
  book: TTradingAccount,
  position: StockPosition | undefined,
  rememberTrade = true
): AppState {
  const market = book.market ?? marketFromQuoteId(book.quoteId)
  const accountId = book.accountId ?? defaultAccountId(market)
  const owner = state.securitiesAccounts?.[accountId]
  if (!owner || owner.market !== market) throw new Error('请选择该市场的股票账户')
  const previous = getStockAccountBook(state.stockTradingBooks, book.quoteId, accountId)
  const hasNewTrade = book.tradeRecords.some(
    (record) =>
      record.origin !== 'opening-balance' &&
      !previous?.tradeRecords.some((old) => old.id === record.id)
  )
  const newEntries = book.ledger.entries.some(
    (entry) =>
      entry.kind !== 'reversal' && !previous?.ledger.entries.some((old) => old.id === entry.id)
  )
  if (!owner.enabled && (newEntries || (position?.quantity ?? 0) > 0))
    throw new Error('请先恢复启用该账户')
  const parent = state.stockTradingBooks[book.quoteId]
  const children = parent && 'accounts' in parent ? parent.accounts : {}
  const next = {
    ...state,
    stockTradingBooks: {
      ...state.stockTradingBooks,
      [book.quoteId]: {
        ...(parent && 'accounts' in parent ? parent : {}),
        quoteId: book.quoteId,
        accounts: {
          ...children,
          [accountId]: { ...book, accountId, accountName: owner.name, position }
        }
      }
    },
    settings:
      rememberTrade && hasNewTrade
        ? {
            ...state.settings,
            lastUsedAccountIdByMarket: {
              ...state.settings.lastUsedAccountIdByMarket,
              [market]: accountId
            }
          }
        : state.settings
  }
  const updatedParent = next.stockTradingBooks[book.quoteId] as StockTradingBook
  next.stockTradingBooks[book.quoteId] = reconcileStockTBatches(
    updatedParent,
    state.settings.tPlanDefaults,
    parent
  )
  return normalizeAccountState(next)
}

export function upsertStockTradingBook(state: AppState, book: StockTradingBook): AppState {
  const previous = state.stockTradingBooks[book.quoteId]
  const previousAccounts = previous && 'accounts' in previous ? previous.accounts : {}
  let lastTradeAccountId: string | undefined
  for (const [id, account] of Object.entries(book.accounts)) {
    const owner = state.securitiesAccounts?.[id]
    if (!owner || owner.market !== marketFromQuoteId(book.quoteId))
      throw new Error('股票账户归属无效')
    const old = previousAccounts[id]
    const newTrade = account.tradeRecords.some(
      (trade) =>
        trade.origin !== 'opening-balance' &&
        !old?.tradeRecords.some((record) => record.id === trade.id)
    )
    const newCash = account.ledger.entries.some(
      (entry) =>
        (entry.kind === 'cashDividend' || entry.kind === 'withholdingTax') &&
        !old?.ledger.entries.some((record) => record.id === entry.id)
    )
    if (!owner.enabled && (newTrade || newCash)) throw new Error('请先恢复启用该账户')
    if (newTrade) lastTradeAccountId = id
  }
  const market = marketFromQuoteId(book.quoteId)
  return normalizeAccountState({
    ...state,
    stockTradingBooks: { ...state.stockTradingBooks, [book.quoteId]: book },
    settings: lastTradeAccountId
      ? {
          ...state.settings,
          lastUsedAccountIdByMarket: {
            ...state.settings.lastUsedAccountIdByMarket,
            [market]: lastTradeAccountId
          }
        }
      : state.settings
  })
}
