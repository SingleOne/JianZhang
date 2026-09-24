import { CheckCircle2, PencilLine, Plus, RefreshCcw, Repeat2, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  formatCost,
  formatCurrency,
  formatMoney,
  formatMoneyProfit,
  formatPercent,
  formatPrice,
  formatProfit,
  formatShares
} from '../lib/format'
import {
  applyTAlertTriggers,
  getTPlanRows,
  handleTPlanAlert,
  handleTriggeredTPlanAlertsForTrade,
  restoreTPlanAlert,
  setTAlertEnabled,
  setTFloatingProfitAlertEnabled,
  setTFloatingProfitAlertThreshold,
  updateTPlanLevel,
  type TAlertSide
} from '../lib/t-alerts'
import {
  calculateMarketTradeFeeItems,
  estimateSettlementDate,
  marketFeeTemplateForTradeDate,
  marketTradeQuantityError,
  settlementRuleForTradeDate,
  totalTradeFeeItems
} from '../lib/market-trades'
import {
  calculateCostAdjustedProfit,
  calculateTBatchMetrics,
  calculateTradeFees,
  createTPlanLevelsFromDefaults,
  getTBatchDirection,
  rebalanceTBatchPlans,
  resetTBatchPlans,
  roundMoney,
  getTradeBatchAllocationAmounts,
  totalRecordedTradeFees,
  totalTradeFees,
  validateTBatchSettlementPosition,
  validateTBatchTrades
} from '../lib/t-trading'
import { calculateTBatchCnyMetrics, type TBatchCnyMetrics } from '../lib/t-batch-currency'
import {
  detachTradeRecordsFromBatch,
  getTradeAllocations,
  getBatchTrades,
  hasTAllocationForBatch,
  isIndependentBaseTrade,
  toTradeRecord,
  tradeReferencesBatch,
  upsertTradeRecord
} from '../lib/trade-records'
import {
  activePortfolioLedgerEntries,
  calculatePortfolioLedgerPosition
} from '../lib/portfolio-ledger'
import { deleteIndependentBaseTrade, upsertIndependentBaseTrade } from '../lib/base-trades'
import { appendPositionAdjustment, createInitialPositionAccount } from '../lib/position-ledger'
import { splitTradeForOverflow } from '../lib/split-trade'
import { TradeSplitSource } from './TradeSplitSource'
import { TPlanTable } from './TPlanTable'
import { TFloatingProfitAlertBadge } from './TFloatingProfitAlertBadge'
import type {
  CashDividendLedgerEntry,
  ExchangeRateSettings,
  MarketTradeFeeSettings,
  PortfolioLedgerEntry,
  StockPosition,
  StockQuote,
  TPlanDefaultSettings,
  TTradingAccount,
  TTradingBatch,
  TTradingFeeSettings,
  TTrade,
  TTradeFees,
  TTradePurpose,
  TTradeSide,
  TradingCalendarSettings,
  WithholdingTaxLedgerEntry,
  WatchStock
} from '../shared/types'
import { appendPortfolioLedgerEntries, withLedgerTradeRecords } from '../shared/types'
import { exchangeRateForCurrency } from '../shared/exchange-rates'
import { marketDateTimeInput } from '../shared/market-hours'
import { currencyForMarket, marketFromQuoteId } from '../shared/stock-market'
import { useConfirmDialog } from './ConfirmDialog'

interface TTradingDrawerProps {
  stock: WatchStock
  quote: StockQuote | undefined
  account: TTradingAccount | undefined
  holdingCost: number | null | undefined
  holdingCostBasis: number | null | undefined
  feeSettings: TTradingFeeSettings
  marketTradeFees: MarketTradeFeeSettings
  planDefaults: TPlanDefaultSettings
  tradingCalendar: TradingCalendarSettings
  exchangeRates: ExchangeRateSettings
  floatingProfitAlertDefaultThreshold: number
  onApply: (account: TTradingAccount, position: StockPosition | undefined) => void
  onClose: () => void
}

const HISTORY_PAGE_SIZE = 10
type OverflowDisposition = 'base' | 'opposite-t'
type EntryMode = 'trade' | 'cash'
type CashEntryKind = 'cashDividend' | 'withholdingTax'
type CashLedgerEntry = CashDividendLedgerEntry | WithholdingTaxLedgerEntry

function emptyFees(): TTradeFees {
  return { commission: 0, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 }
}

function tradeFeeSourceLabel(trade: TTrade): string {
  if (trade.feeSource === 'actual' || trade.feeItems?.some((item) => item.code === 'manual')) {
    return '券商实际'
  }
  if (trade.feeTemplate) return `模板估算 v${trade.feeTemplate.version}`
  return trade.feeSource === 'estimated' ? '模板估算' : '来源未标记'
}

function positionSnapshot(position: StockPosition | undefined) {
  return position
    ? { quantity: position.quantity, cost: position.cost, openedOn: position.openedOn }
    : undefined
}

function valueClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function tBatchCnyIssue(metrics: TBatchCnyMetrics): string | null {
  const issues: string[] = []
  if (metrics.missingHistoricalRate) issues.push('部分成交缺少历史汇率')
  if (metrics.missingCurrentRate) issues.push('缺少当前汇率')
  if (metrics.missingQuote) issues.push('缺少当前行情')
  return issues.length > 0 ? issues.join('；') : null
}

function formatOverviewValue(
  value: number | null | undefined,
  formatter: (value: number) => string
): string {
  return value ? formatter(value) : '-'
}

function formatTradeTime(value: string): string {
  return value.replace('T', ' ').slice(0, 16)
}

function batchDirectionLabel(batch: TTradingBatch | undefined): string {
  return getTBatchDirection(batch) === 'reverse' ? '反T' : '正T'
}

function tradeLabel(trade: TTrade, batch: TTradingBatch | undefined): string {
  const allocation = batch ? getTradeBatchAllocationAmounts(trade, batch) : null
  if (allocation && allocation.tQuantity > 0 && allocation.baseQuantity > 0) {
    return trade.side === 'buy' ? 'T仓 / 底仓买入' : 'T仓 / 底仓卖出'
  }
  if (allocation ? allocation.tQuantity <= 0 : trade.purpose === 'base') {
    return trade.side === 'buy' ? '底仓买入' : '底仓卖出'
  }
  if (getTBatchDirection(batch) === 'reverse') {
    return trade.side === 'sell' ? '反T卖出' : '回补买入'
  }
  return trade.side === 'buy' ? 'T仓买入' : 'T仓卖出'
}

function allocationSummary(trade: TTrade, batch: TTradingBatch): string | null {
  const allocation = getTradeBatchAllocationAmounts(trade, batch)
  if (allocation.tQuantity > 0 && allocation.baseQuantity > 0) {
    return `T仓 ${formatShares(allocation.tQuantity)} / 底仓 ${formatShares(allocation.baseQuantity)}`
  }
  if (trade.allocations && trade.allocations.length > 1 && allocation.quantity < trade.quantity) {
    return `本批次 ${formatShares(allocation.quantity)} / 整笔 ${formatShares(trade.quantity)}`
  }
  return null
}

function spansMultipleBatches(trade: TTrade): boolean {
  return (
    new Set(
      (trade.allocations ?? [])
        .map((allocation) => allocation.batchId)
        .filter((batchId): batchId is string => Boolean(batchId))
    ).size > 1
  )
}

function isCashLedgerEntry(entry: PortfolioLedgerEntry): entry is CashLedgerEntry {
  return entry.kind === 'cashDividend' || entry.kind === 'withholdingTax'
}

function cashLedgerAmount(entry: CashLedgerEntry): number {
  return entry.kind === 'cashDividend' ? entry.amount : -entry.amount
}

function cashLedgerSourceLabel(entry: CashLedgerEntry): string {
  if (entry.source === 'manual') return '手工录入'
  if (entry.source === 'corporateAction') return '公司行动'
  if (entry.source === 'brokerImport') return '券商导入'
  return '交易录入'
}

export function TTradingDrawer({
  stock,
  quote,
  account,
  holdingCost,
  holdingCostBasis,
  feeSettings,
  marketTradeFees,
  planDefaults,
  tradingCalendar,
  exchangeRates,
  floatingProfitAlertDefaultThreshold,
  onApply,
  onClose
}: TTradingDrawerProps) {
  const confirm = useConfirmDialog()
  const market = stock.market ?? marketFromQuoteId(stock.quoteId)
  const currency = stock.currency ?? currencyForMarket(market)
  const effectiveExchangeRate = exchangeRateForCurrency(exchangeRates, currency)
  const currentAccount = useMemo<TTradingAccount>(
    () =>
      account
        ? {
            ...account,
            market: account.market ?? market,
            currency: account.currency ?? currency
          }
        : {
            quoteId: stock.quoteId,
            code: stock.code,
            name: stock.name,
            market,
            currency,
            history: [],
            ledger: { schemaVersion: 1, entries: [] },
            tradeRecords: []
          },
    [account, currency, market, stock.code, stock.name, stock.quoteId]
  )
  const [entryMode, setEntryMode] = useState<EntryMode>('trade')
  const [side, setSide] = useState<TTradeSide>('buy')
  const [purpose, setPurpose] = useState<TTradePurpose>('t')
  const [price, setPrice] = useState(quote?.latest?.toString() ?? '')
  const [quantity, setQuantity] = useState('')
  const [tradedAt, setTradedAt] = useState(() => marketDateTimeInput(market))
  const [actualSettlementDate, setActualSettlementDate] = useState('')
  const [note, setNote] = useState('')
  const [manualFees, setManualFees] = useState(false)
  const [feeModeEdited, setFeeModeEdited] = useState(false)
  const [feeOverrides, setFeeOverrides] = useState<TTradeFees>(emptyFees)
  const [actualFees, setActualFees] = useState('')
  const [tradeExchangeRate, setTradeExchangeRate] = useState(
    currency === 'CNY' ? '1' : (effectiveExchangeRate?.toString() ?? '')
  )
  const [tradeExchangeRateEdited, setTradeExchangeRateEdited] = useState(false)
  const [overflowDisposition, setOverflowDisposition] = useState<OverflowDisposition>('base')
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [planError, setPlanError] = useState('')
  const [settlementBatchId, setSettlementBatchId] = useState('')
  const [latestPositionQuantity, setLatestPositionQuantity] = useState(
    stock.position?.quantity.toString() ?? '0'
  )
  const [latestPositionCost, setLatestPositionCost] = useState(holdingCost?.toString() ?? '')
  const [settlementNote, setSettlementNote] = useState('')
  const [editingHistoryBatchId, setEditingHistoryBatchId] = useState<string | null>(null)
  const [historyProfitDraft, setHistoryProfitDraft] = useState('')
  const [historyProfitError, setHistoryProfitError] = useState('')
  const [editingHistoryCostBatchId, setEditingHistoryCostBatchId] = useState<string | null>(null)
  const [historyCostDraft, setHistoryCostDraft] = useState('')
  const [historyCostError, setHistoryCostError] = useState('')
  const [showAllActiveTrades, setShowAllActiveTrades] = useState(false)
  const [showAllBaseLedgerEntries, setShowAllBaseLedgerEntries] = useState(false)
  const [cashEntryKind, setCashEntryKind] = useState<CashEntryKind>('cashDividend')
  const [cashAmount, setCashAmount] = useState('')
  const [cashEligibleQuantity, setCashEligibleQuantity] = useState(
    stock.position?.quantity.toString() ?? ''
  )
  const [cashOccurredAt, setCashOccurredAt] = useState(() => marketDateTimeInput(market))
  const [cashExchangeRateInput, setCashExchangeRateInput] = useState(
    currency === 'CNY' ? '1' : (effectiveExchangeRate?.toString() ?? '')
  )
  const [cashExchangeRateEdited, setCashExchangeRateEdited] = useState(false)
  const [cashNote, setCashNote] = useState('')
  const [cashError, setCashError] = useState('')
  const [historyPage, setHistoryPage] = useState(0)

  const activeTrades = getBatchTrades(currentAccount, currentAccount.activeBatch)
  const activeMetrics = useMemo(
    () => calculateTBatchMetrics(currentAccount.activeBatch, activeTrades, quote?.latest),
    [activeTrades, currentAccount.activeBatch, quote?.latest]
  )
  const activeCnyMetrics = useMemo(
    () =>
      market !== 'CN' && currentAccount.activeBatch
        ? calculateTBatchCnyMetrics(
            currentAccount.activeBatch,
            activeTrades,
            market,
            quote?.latest,
            effectiveExchangeRate
          )
        : null,
    [activeTrades, currentAccount.activeBatch, effectiveExchangeRate, market, quote?.latest]
  )
  const activeCnyIssue = activeCnyMetrics ? tBatchCnyIssue(activeCnyMetrics) : null
  const entryMetrics = useMemo(
    () =>
      currentAccount.activeBatch
        ? calculateTBatchMetrics(
            currentAccount.activeBatch,
            activeTrades.filter(
              (trade) => trade.id !== editingTradeId && trade.tradedAt <= tradedAt
            ),
            quote?.latest
          )
        : activeMetrics,
    [
      activeMetrics,
      activeTrades,
      currentAccount.activeBatch,
      editingTradeId,
      quote?.latest,
      tradedAt
    ]
  )
  const isReverseBatch = activeMetrics.direction === 'reverse'
  const closingPlanQuantity = (
    isReverseBatch
      ? (currentAccount.activeBatch?.buyLevels ?? [])
      : (currentAccount.activeBatch?.sellLevels ?? [])
  ).reduce((sum, level) => sum + level.quantity, 0)
  const closingPlanOverAllocated =
    market !== 'CN' && closingPlanQuantity > activeMetrics.remainingQuantity
  const hasOddLotPlan =
    market === 'HK' &&
    Boolean(
      currentAccount.boardLotSize &&
      [
        ...(currentAccount.activeBatch?.buyLevels ?? []),
        ...(currentAccount.activeBatch?.sellLevels ?? [])
      ].some(
        (level) => level.quantity > 0 && level.quantity % (currentAccount.boardLotSize ?? 1) !== 0
      )
    )
  const tPurposeLabel = currentAccount.activeBatch
    ? isReverseBatch
      ? side === 'sell'
        ? '增加反T'
        : '回补反T'
      : side === 'buy'
        ? '计入T仓'
        : '卖出T仓'
    : side === 'buy'
      ? '开启正T'
      : '开启反T'
  const basePurposeLabel = side === 'buy' ? '增加底仓' : '减持底仓'
  const entryHint =
    entryMode === 'cash'
      ? '现金流水参与收益统计，不改变持仓数量和持仓成本'
      : purpose === 'base'
        ? '底仓交易独立于 T 批次，保存后按全部历史流水重算当前持仓'
        : currentAccount.activeBatch
          ? isReverseBatch
            ? '反T批次：卖出建立待回补数量，买入用于回补反T'
            : '正T批次：买入建立T仓，卖出用于清空T仓'
          : '计入T仓的首笔买入开启正T，首笔卖出开启反T'
  const totalHistoryProfit = currentAccount.history.reduce(
    (total, batch) => total + (batch.settlement?.finalProfit ?? 0),
    0
  )
  const currentBatchFees = activeTrades.reduce(
    (total, trade) =>
      total +
      (currentAccount.activeBatch
        ? getTradeBatchAllocationAmounts(trade, currentAccount.activeBatch).fees
        : 0),
    0
  )
  const totalHistoryFees = currentAccount.history.reduce(
    (total, batch) =>
      total +
      getBatchTrades(currentAccount, batch).reduce(
        (batchTotal, trade) => batchTotal + getTradeBatchAllocationAmounts(trade, batch).fees,
        0
      ),
    0
  )
  const historyPageCount = Math.ceil(currentAccount.history.length / HISTORY_PAGE_SIZE)
  const currentHistoryPage = Math.min(historyPage, Math.max(0, historyPageCount - 1))
  const visibleHistoryBatches = currentAccount.history.slice(
    currentHistoryPage * HISTORY_PAGE_SIZE,
    (currentHistoryPage + 1) * HISTORY_PAGE_SIZE
  )
  const numericPrice = Number(price)
  const numericQuantity = Number(quantity)
  const editingTrade = editingTradeId
    ? currentAccount.tradeRecords.find((record) => record.id === editingTradeId)
    : undefined
  const hasFixedAllocations = Boolean(editingTrade && getTradeAllocations(editingTrade).length > 1)
  const isClosingTTrade = Boolean(
    currentAccount.activeBatch &&
    purpose === 't' &&
    ((activeMetrics.direction === 'forward' && side === 'sell') ||
      (activeMetrics.direction === 'reverse' && side === 'buy'))
  )
  const overflowQuantity =
    !hasFixedAllocations && isClosingTTrade
      ? Math.max(0, numericQuantity - entryMetrics.remainingQuantity)
      : 0
  const calculatedFees = useMemo(
    () =>
      calculateTradeFees(
        Math.max(0, numericPrice * numericQuantity),
        side,
        feeSettings,
        stock.marketLabel
      ),
    [feeSettings, numericPrice, numericQuantity, side, stock.marketLabel]
  )
  const tradeDate = tradedAt.slice(0, 10)
  const marketFeeTemplate = marketFeeTemplateForTradeDate(market, tradeDate)
  const calculatedMarketFeeItems = useMemo(
    () =>
      market !== 'CN' && marketFeeTemplate
        ? calculateMarketTradeFeeItems(
            market,
            Math.max(0, numericPrice * numericQuantity),
            Math.max(0, numericQuantity),
            side,
            marketTradeFees,
            { stampDutyExempt: stock.instrumentType === 'etf', tradeDate }
          )
        : [],
    [
      market,
      marketFeeTemplate,
      marketTradeFees,
      numericPrice,
      numericQuantity,
      side,
      stock.instrumentType,
      tradeDate
    ]
  )
  const preservesEstimatedFees = Boolean(
    market !== 'CN' &&
    !manualFees &&
    editingTrade?.feeTemplate &&
    editingTrade.feeSource !== 'actual' &&
    editingTrade.side === side &&
    editingTrade.price === numericPrice &&
    editingTrade.quantity === numericQuantity &&
    (editingTrade.marketDate ?? editingTrade.tradedAt.slice(0, 10)) === tradeDate
  )
  const selectedFeeTemplate =
    preservesEstimatedFees && editingTrade?.feeTemplate
      ? editingTrade.feeTemplate
      : marketFeeTemplate
  const preservesUnknownFeeSource = Boolean(
    editingTrade &&
    !feeModeEdited &&
    editingTrade.feeSource === undefined &&
    !editingTrade.feeItems?.some((item) => item.code === 'manual')
  )
  const preservesRecordedFees = Boolean(
    market !== 'CN' &&
    manualFees &&
    editingTrade &&
    !editingTrade.feeTemplate &&
    actualFees.trim() !== '' &&
    Number.isFinite(Number(actualFees)) &&
    roundMoney(Number(actualFees)) === totalRecordedTradeFees(editingTrade)
  )
  const tradeFees =
    market === 'CN'
      ? manualFees
        ? feeOverrides
        : calculatedFees
      : (preservesRecordedFees || preservesEstimatedFees) && editingTrade
        ? editingTrade.fees
        : emptyFees()
  const tradeFeeItems =
    market === 'CN'
      ? undefined
      : manualFees
        ? preservesRecordedFees && editingTrade
          ? editingTrade.feeItems
          : actualFees.trim() === '' ||
              !Number.isFinite(Number(actualFees)) ||
              Number(actualFees) < 0
            ? []
            : [
                {
                  code: 'manual' as const,
                  label: '券商实际费用',
                  amount: roundMoney(Number(actualFees))
                }
              ]
        : preservesEstimatedFees && editingTrade
          ? editingTrade.feeItems
          : calculatedMarketFeeItems
  const tradeFeeTotal =
    market === 'CN'
      ? totalTradeFees(tradeFees)
      : (preservesRecordedFees || preservesEstimatedFees) && editingTrade
        ? totalRecordedTradeFees(editingTrade)
        : totalTradeFeeItems(tradeFeeItems)
  const formatNativeAmount = (value: number | null | undefined) =>
    currency === 'CNY' ? formatCurrency(value) : formatMoney(value, currency)
  const formatNativeProfit = (value: number | null | undefined) =>
    currency === 'CNY' ? formatProfit(value) : formatMoneyProfit(value, currency)
  const readyToSettle = Boolean(
    currentAccount.activeBatch &&
    activeTrades.some((trade) => hasTAllocationForBatch(trade, currentAccount.activeBatch!.id)) &&
    activeMetrics.remainingQuantity === 0
  )
  const settlementPreviewProfit =
    currentAccount.activeBatch &&
    holdingCostBasis !== null &&
    holdingCostBasis !== undefined &&
    latestPositionCost.trim() !== ''
      ? calculateCostAdjustedProfit(
          activeMetrics.realizedProfit,
          holdingCostBasis,
          Math.max(0, Number(latestPositionQuantity) || 0),
          Number(latestPositionCost) || 0
        )
      : null

  useEffect(() => {
    const batchId = currentAccount.activeBatch?.id
    if (!readyToSettle || !batchId || settlementBatchId === batchId) return
    setSettlementBatchId(batchId)
    setLatestPositionQuantity(stock.position?.quantity.toString() ?? '0')
    setLatestPositionCost(holdingCost?.toString() ?? '')
  }, [
    currentAccount.activeBatch?.id,
    holdingCost,
    readyToSettle,
    settlementBatchId,
    stock.position?.quantity
  ])

  const buyLevelRows = useMemo(
    () =>
      getTPlanRows(
        currentAccount.activeBatch,
        activeTrades,
        'buy',
        feeSettings,
        stock.marketLabel,
        {
          market,
          marketTradeFees,
          stampDutyExempt: stock.instrumentType === 'etf',
          instrumentType: stock.instrumentType
        }
      ),
    [
      activeTrades,
      currentAccount.activeBatch,
      feeSettings,
      market,
      marketTradeFees,
      stock.instrumentType,
      stock.marketLabel
    ]
  )
  const sellLevelRows = useMemo(
    () =>
      getTPlanRows(
        currentAccount.activeBatch,
        activeTrades,
        'sell',
        feeSettings,
        stock.marketLabel,
        {
          market,
          marketTradeFees,
          stampDutyExempt: stock.instrumentType === 'etf',
          instrumentType: stock.instrumentType
        }
      ),
    [
      activeTrades,
      currentAccount.activeBatch,
      feeSettings,
      market,
      marketTradeFees,
      stock.instrumentType,
      stock.marketLabel
    ]
  )
  const activeTradesDescending = useMemo(
    () =>
      activeTrades
        .map((trade, index) => ({ trade, index }))
        .sort(
          (left, right) =>
            right.trade.tradedAt.localeCompare(left.trade.tradedAt) || right.index - left.index
        )
        .map(({ trade }) => trade),
    [activeTrades]
  )
  const visibleActiveTrades = showAllActiveTrades
    ? activeTradesDescending
    : activeTradesDescending.slice(0, 5)
  const independentBaseTradesDescending = useMemo(
    () =>
      currentAccount.tradeRecords
        .filter(isIndependentBaseTrade)
        .sort((left, right) => right.tradedAt.localeCompare(left.tradedAt)),
    [currentAccount.tradeRecords]
  )
  const cashLedgerEntriesDescending = useMemo(
    () => activePortfolioLedgerEntries(currentAccount).filter(isCashLedgerEntry).reverse(),
    [currentAccount]
  )
  const baseLedgerEntriesDescending = useMemo(
    () =>
      [
        ...independentBaseTradesDescending.map((trade) => ({
          kind: 'trade' as const,
          occurredAt: trade.tradedAt,
          trade
        })),
        ...cashLedgerEntriesDescending.map((entry) => ({
          kind: 'cash' as const,
          occurredAt: entry.occurredAt,
          entry
        }))
      ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
    [cashLedgerEntriesDescending, independentBaseTradesDescending]
  )
  const visibleBaseLedgerEntries = showAllBaseLedgerEntries
    ? baseLedgerEntriesDescending
    : baseLedgerEntriesDescending.slice(0, 5)
  const cashLedgerNetAmount = cashLedgerEntriesDescending.reduce(
    (total, entry) => total + cashLedgerAmount(entry),
    0
  )

  const resetTradeForm = () => {
    setEntryMode('trade')
    setSide('buy')
    setPurpose('t')
    setPrice(quote?.latest?.toString() ?? '')
    setQuantity('')
    setTradedAt(marketDateTimeInput(market))
    setActualSettlementDate('')
    setNote('')
    setManualFees(false)
    setFeeModeEdited(false)
    setFeeOverrides(emptyFees())
    setActualFees('')
    setTradeExchangeRate(currency === 'CNY' ? '1' : (effectiveExchangeRate?.toString() ?? ''))
    setTradeExchangeRateEdited(false)
    setOverflowDisposition('base')
    setEditingTradeId(null)
    setError('')
    setCashError('')
  }

  const applyAccount = (nextAccount: TTradingAccount, nextPosition: StockPosition | undefined) => {
    onApply(nextAccount, nextPosition)
  }

  const applyTradeAccount = (nextAccount: TTradingAccount): boolean => {
    const replay = calculatePortfolioLedgerPosition(nextAccount, market, currency)
    if (replay.error) {
      setError(`完整账本校验失败：${replay.error}`)
      return false
    }
    applyAccount(nextAccount, replay.position)
    return true
  }

  const applyCashAccount = (nextAccount: TTradingAccount): boolean => {
    const replay = calculatePortfolioLedgerPosition(nextAccount, market, currency)
    if (replay.error) {
      setCashError(`完整账本校验失败：${replay.error}`)
      return false
    }
    applyAccount(nextAccount, replay.position)
    return true
  }

  const resetCashForm = () => {
    setCashAmount('')
    setCashEligibleQuantity(stock.position?.quantity.toString() ?? '')
    setCashOccurredAt(marketDateTimeInput(market))
    setCashExchangeRateInput(currency === 'CNY' ? '1' : (effectiveExchangeRate?.toString() ?? ''))
    setCashExchangeRateEdited(false)
    setCashNote('')
    setCashError('')
  }

  const saveCashEntry = () => {
    const amount = roundMoney(Number(cashAmount))
    if (!Number.isFinite(amount) || amount <= 0) {
      setCashError(
        cashEntryKind === 'cashDividend' ? '请输入有效的税前分红金额' : '请输入有效的缴税金额'
      )
      return
    }
    if (!cashOccurredAt) {
      setCashError('请选择发生时间')
      return
    }

    const eligibleQuantity = cashEligibleQuantity.trim() ? Number(cashEligibleQuantity) : 0
    if (
      cashEntryKind === 'cashDividend' &&
      (!Number.isFinite(eligibleQuantity) ||
        eligibleQuantity < 0 ||
        !Number.isInteger(eligibleQuantity))
    ) {
      setCashError('请输入有效的登记股数，未知时可以留空')
      return
    }
    const cashRate =
      currency === 'CNY'
        ? 1
        : cashExchangeRateInput.trim() === ''
          ? undefined
          : Number(cashExchangeRateInput)
    if (cashRate !== undefined && (!Number.isFinite(cashRate) || cashRate <= 0)) {
      setCashError('请输入有效的成交汇率，未知时可以留空')
      return
    }

    const common = {
      accountId: currentAccount.quoteId,
      quoteId: currentAccount.quoteId,
      occurredAt: cashOccurredAt,
      marketDate: cashOccurredAt.slice(0, 10),
      recordedAt: new Date().toISOString(),
      source: 'manual' as const,
      currency,
      exchangeRate: cashRate,
      exchangeRateDate:
        currency === 'CNY' || cashRate === undefined
          ? undefined
          : cashExchangeRateEdited || exchangeRates.manualOverrides[currency] !== undefined
            ? cashOccurredAt.slice(0, 10)
            : (exchangeRates.rateDate ?? cashOccurredAt.slice(0, 10)),
      note: cashNote.trim() || undefined
    }
    const hasPositionLedgerEntries = activePortfolioLedgerEntries(currentAccount).some(
      (entry) =>
        entry.kind === 'trade' ||
        entry.kind === 'positionAdjustment' ||
        entry.kind === 'shareAdjustment' ||
        entry.kind === 'rightsSubscription' ||
        entry.kind === 'securityConversion'
    )
    const workingAccount =
      stock.position && !hasPositionLedgerEntries
        ? createInitialPositionAccount(
            currentAccount,
            {
              quoteId: stock.quoteId,
              code: stock.code,
              name: stock.name,
              market,
              currency
            },
            stock.position,
            cashOccurredAt
          )
        : currentAccount
    const entry: CashLedgerEntry =
      cashEntryKind === 'cashDividend'
        ? {
            ...common,
            id: `cash-dividend:${crypto.randomUUID()}`,
            kind: 'cashDividend',
            eligibleQuantity,
            amountPerShare: eligibleQuantity > 0 ? amount / eligibleQuantity : 0,
            amount
          }
        : {
            ...common,
            id: `withholding-tax:${crypto.randomUUID()}`,
            kind: 'withholdingTax',
            amount
          }

    if (!applyCashAccount(appendPortfolioLedgerEntries(workingAccount, [entry]))) return
    resetCashForm()
  }

  const deleteCashEntry = (entry: CashLedgerEntry) => {
    if (entry.source === 'corporateAction' || entry.corporateActionId) {
      setCashError('公司行动产生的流水请在公司行动中撤销')
      return
    }
    const nextAccount = {
      ...currentAccount,
      ledger: {
        ...currentAccount.ledger,
        entries: currentAccount.ledger.entries.filter((item) => item.id !== entry.id)
      }
    }
    if (!applyCashAccount(nextAccount)) return
    setCashError('')
  }

  const createBatch = (
    direction: TTradingBatch['direction'],
    openedAt: string,
    openingPosition: StockPosition | undefined
  ): TTradingBatch => ({
    id: crypto.randomUUID(),
    sequence:
      Math.max(
        0,
        currentAccount.activeBatch?.sequence ?? 0,
        ...currentAccount.history.map((item) => item.sequence)
      ) + 1,
    openedAt,
    direction,
    openingPosition: positionSnapshot(openingPosition),
    buyLevels: createTPlanLevelsFromDefaults(planDefaults.buyLevels),
    sellLevels: createTPlanLevelsFromDefaults(planDefaults.sellLevels),
    alertEnabled: false,
    floatingProfitAlert: {
      enabled: false,
      threshold: floatingProfitAlertDefaultThreshold,
      status: 'armed'
    }
  })

  const saveTrade = () => {
    if (!tradedAt || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      setError('请输入有效的成交价格和数量')
      return
    }
    const quantityError = marketTradeQuantityError(market, numericQuantity)
    if (quantityError) {
      setError(quantityError)
      return
    }
    if (market !== 'CN' && !manualFees && !marketFeeTemplate) {
      setError('该成交日期早于内置费用模板，请切换为手动费用并填写券商实际费用')
      return
    }
    if (market !== 'CN' && actualSettlementDate && actualSettlementDate < tradeDate) {
      setError('实际交收日不能早于成交日')
      return
    }
    if (
      market !== 'CN' &&
      manualFees &&
      (actualFees.trim() === '' || !Number.isFinite(Number(actualFees)) || Number(actualFees) < 0)
    ) {
      setError('请填写有效的券商实际费用，零费用请填写 0')
      return
    }
    const exchangeRate =
      currency === 'CNY'
        ? 1
        : tradeExchangeRate.trim() === ''
          ? undefined
          : Number(tradeExchangeRate)
    if (exchangeRate !== undefined && (!Number.isFinite(exchangeRate) || exchangeRate <= 0)) {
      setError('请输入有效的成交汇率，未知时可以留空')
      return
    }

    const baseTrade: TTrade = {
      id: editingTradeId ?? crypto.randomUUID(),
      side,
      purpose,
      tradedAt,
      price: numericPrice,
      quantity: numericQuantity,
      fees: tradeFees,
      feeItems: tradeFeeItems,
      feeTemplate: market === 'CN' || manualFees ? undefined : selectedFeeTemplate,
      feeSource:
        market === 'CN'
          ? undefined
          : manualFees
            ? preservesUnknownFeeSource
              ? undefined
              : 'actual'
            : 'estimated',
      market,
      currency,
      marketDate: tradeDate,
      exchangeRate,
      exchangeRateDate:
        currency === 'CNY' || exchangeRate === undefined
          ? undefined
          : editingTrade && !tradeExchangeRateEdited && editingTrade.exchangeRate === exchangeRate
            ? editingTrade.exchangeRateDate
            : tradeExchangeRateEdited || exchangeRates.manualOverrides[currency] !== undefined
              ? tradeDate
              : (exchangeRates.rateDate ?? tradeDate),
      estimatedSettlementDate: estimateSettlementDate(market, tradeDate, tradingCalendar),
      actualSettlementDate:
        market === 'CN' ? editingTrade?.actualSettlementDate : actualSettlementDate || undefined,
      settlementRule: settlementRuleForTradeDate(market, tradeDate),
      origin: editingTrade?.origin ?? 'execution',
      splitSource: editingTrade?.splitSource,
      brokerImport: editingTrade?.brokerImport,
      note: note.trim()
    }
    const hasPositionLedgerEntries = activePortfolioLedgerEntries(currentAccount).some(
      (entry) =>
        entry.kind === 'trade' ||
        entry.kind === 'positionAdjustment' ||
        entry.kind === 'shareAdjustment' ||
        entry.kind === 'rightsSubscription' ||
        entry.kind === 'securityConversion'
    )
    const workingAccount =
      stock.position && !hasPositionLedgerEntries
        ? createInitialPositionAccount(
            currentAccount,
            {
              quoteId: stock.quoteId,
              code: stock.code,
              name: stock.name,
              market,
              currency
            },
            stock.position,
            tradedAt
          )
        : currentAccount

    if (purpose === 'base') {
      const result = upsertIndependentBaseTrade(
        workingAccount,
        baseTrade,
        market,
        currency,
        stock.position
      )
      if (result.error) {
        setError(`完整账本校验失败：${result.error}`)
        return
      }
      let nextAccount = result.account
      const editedBatch = currentAccount.activeBatch
      if (editingTrade && editedBatch && tradeReferencesBatch(editingTrade, editedBatch.id)) {
        const remainingBatchTrades = getBatchTrades(nextAccount, editedBatch)
        const validationError = validateTBatchTrades(editedBatch, remainingBatchTrades)
        if (validationError) {
          setError(validationError)
          return
        }
        nextAccount = {
          ...nextAccount,
          activeBatch: remainingBatchTrades.some((trade) =>
            hasTAllocationForBatch(trade, editedBatch.id)
          )
            ? rebalanceTBatchPlans(editedBatch, remainingBatchTrades, planDefaults, market)
            : undefined
        }
      }
      applyAccount(nextAccount, result.position)
      resetTradeForm()
      return
    }

    let batch: TTradingBatch
    let batchTrades: TTrade[]
    if (currentAccount.activeBatch) {
      batch = currentAccount.activeBatch
      batchTrades = activeTrades.filter((item) => item.id !== editingTradeId)
    } else {
      batch = createBatch(side === 'buy' ? 'forward' : 'reverse', tradedAt, stock.position)
      batchTrades = []
    }

    if (
      !editingTradeId &&
      activeMetrics.remainingQuantity === 0 &&
      batchTrades.some((item) => hasTAllocationForBatch(item, batch.id))
    ) {
      setError('当前批次已清空，请先完成结算')
      return
    }

    if (editingTrade && spansMultipleBatches(editingTrade)) {
      setError('跨批次成交不能直接修改，请删除后重新录入')
      return
    }

    const isOverflow = Boolean(
      currentAccount.activeBatch &&
      purpose === 't' &&
      isClosingTTrade &&
      entryMetrics.remainingQuantity > 0 &&
      numericQuantity > entryMetrics.remainingQuantity &&
      !hasFixedAllocations
    )

    if (isOverflow && overflowDisposition === 'opposite-t') {
      if (batchTrades.some((item) => item.tradedAt > tradedAt)) {
        setError('开启反向T批次的成交时间不能早于当前批次已有流水')
        return
      }
      const nextDirection = getTBatchDirection(batch) === 'forward' ? 'reverse' : 'forward'
      const nextBatchDraft = createBatch(nextDirection, tradedAt, undefined)
      const [trade, nextBatchTrade] = splitTradeForOverflow(
        baseTrade,
        batch,
        entryMetrics.remainingQuantity,
        nextBatchDraft
      )
      const closingTrades = [...batchTrades, trade].sort((left, right) =>
        left.tradedAt.localeCompare(right.tradedAt)
      )
      const closingValidationError = validateTBatchTrades(batch, closingTrades)
      if (closingValidationError) {
        setError(closingValidationError)
        return
      }

      const closingBatch = handleTriggeredTPlanAlertsForTrade(
        rebalanceTBatchPlans(batch, closingTrades, planDefaults, market),
        side
      )
      const closingMetrics = calculateTBatchMetrics(closingBatch, closingTrades, quote?.latest)
      if (closingMetrics.remainingQuantity !== 0) {
        setError('当前交易无法完整结束原T批次')
        return
      }
      const closingAccount = withLedgerTradeRecords(
        workingAccount,
        upsertTradeRecord(workingAccount.tradeRecords, trade)
      )
      const transitionReplay = calculatePortfolioLedgerPosition(
        {
          ...closingAccount,
          ledger: {
            ...closingAccount.ledger,
            entries: closingAccount.ledger.entries.filter((entry) => entry.occurredAt <= tradedAt)
          }
        },
        market,
        currency
      )
      if (transitionReplay.error) {
        setError(`完整账本校验失败：${transitionReplay.error}`)
        return
      }
      const transitionPosition = transitionReplay.position
      const settlement = {
        settledAt: new Date().toISOString(),
        latestPositionQuantity: transitionPosition?.quantity ?? 0,
        latestPositionCost: transitionPosition?.cost,
        ledgerProfit: closingMetrics.realizedProfit,
        finalProfit: closingMetrics.realizedProfit,
        source: 'ledger' as const,
        note: `超出部分自动开启${nextDirection === 'reverse' ? '反T' : '正T'}批次 #${nextBatchDraft.sequence}`
      }
      const settledBatch = { ...closingBatch, settlement }
      const nextBatchBase = {
        ...nextBatchDraft,
        openingPosition: positionSnapshot(transitionPosition)
      }
      const nextBatchTrades = [nextBatchTrade]
      const nextValidationError = validateTBatchTrades(nextBatchBase, nextBatchTrades)
      if (nextValidationError) {
        setError(nextValidationError)
        return
      }
      const nextBatch = rebalanceTBatchPlans(nextBatchBase, nextBatchTrades, planDefaults, market)
      const nextAccount = withLedgerTradeRecords(
        {
          ...workingAccount,
          activeBatch: nextBatch,
          history: [settledBatch, ...workingAccount.history]
        },
        upsertTradeRecord(closingAccount.tradeRecords, nextBatchTrade)
      )
      if (!applyTradeAccount(nextAccount)) return
      setHistoryPage(0)
      resetTradeForm()
      return
    }

    const [trade, baseOverflowTrade]: [TTrade, TTrade?] = isOverflow
      ? splitTradeForOverflow(baseTrade, batch, entryMetrics.remainingQuantity)
      : [
          hasFixedAllocations && editingTrade?.allocations
            ? { ...baseTrade, allocations: editingTrade.allocations }
            : toTradeRecord(baseTrade, batch),
          undefined
        ]

    const nextTrades = [...batchTrades, trade].sort((left, right) =>
      left.tradedAt.localeCompare(right.tradedAt)
    )
    const validationError = validateTBatchTrades(batch, nextTrades)
    if (validationError) {
      setError(validationError)
      return
    }
    let plannedBatch = rebalanceTBatchPlans(batch, nextTrades, planDefaults, market)
    if (hasTAllocationForBatch(trade, batch.id)) {
      plannedBatch = handleTriggeredTPlanAlertsForTrade(plannedBatch, side)
    }
    const hasTTrades = nextTrades.some((item) => hasTAllocationForBatch(item, plannedBatch.id))
    const nextRecords = upsertTradeRecord(workingAccount.tradeRecords, trade)
    if (baseOverflowTrade) {
      const nextAccount = withLedgerTradeRecords(
        { ...workingAccount, activeBatch: plannedBatch },
        upsertTradeRecord(nextRecords, baseOverflowTrade)
      )
      if (!applyTradeAccount(nextAccount)) return
      resetTradeForm()
      return
    }
    if (
      !applyTradeAccount(
        withLedgerTradeRecords(
          {
            ...workingAccount,
            activeBatch: hasTTrades ? plannedBatch : undefined
          },
          hasTTrades ? nextRecords : detachTradeRecordsFromBatch(nextRecords, plannedBatch.id)
        )
      )
    )
      return
    resetTradeForm()
  }

  const editTrade = (trade: TTrade) => {
    if (spansMultipleBatches(trade)) {
      setError('跨批次成交如需调整，请先删除该成交后重新录入')
      return
    }
    setEntryMode('trade')
    setEditingTradeId(trade.id)
    setSide(trade.side)
    setPurpose(trade.purpose)
    setPrice(trade.price.toString())
    setQuantity(trade.quantity.toString())
    setTradedAt(trade.tradedAt)
    setActualSettlementDate(trade.actualSettlementDate ?? '')
    setNote(trade.note)
    setManualFees(market === 'CN' || !trade.feeTemplate)
    setFeeModeEdited(false)
    setFeeOverrides(trade.fees)
    setActualFees(market === 'CN' ? '' : totalRecordedTradeFees(trade).toString())
    setTradeExchangeRate(currency === 'CNY' ? '1' : (trade.exchangeRate?.toString() ?? ''))
    setTradeExchangeRateEdited(false)
    setError('')
    setCashError('')
  }

  const deleteTrade = (tradeId: string) => {
    const record = currentAccount.tradeRecords.find((item) => item.id === tradeId)
    if (record && isIndependentBaseTrade(record)) {
      const result = deleteIndependentBaseTrade(
        currentAccount,
        tradeId,
        market,
        currency,
        stock.position
      )
      if (result.error) {
        setError(`删除后账本不完整：${result.error}`)
        return
      }
      applyAccount(result.account, result.position)
      if (editingTradeId === tradeId) resetTradeForm()
      return
    }

    const batch = currentAccount.activeBatch
    if (!batch) return
    if (record && spansMultipleBatches(record)) {
      const otherActiveTrades = activeTrades.filter((trade) => trade.id !== tradeId)
      if (otherActiveTrades.length > 0) {
        setError('该跨批次成交之后已有新批次流水，不能直接删除')
        return
      }
      const previousBatchId = getTradeAllocations(record)
        .map((allocation) => allocation.batchId)
        .find((batchId) => batchId && batchId !== batch.id)
      const previousBatch = currentAccount.history.find((item) => item.id === previousBatchId)
      if (!previousBatch) {
        setError('找不到跨批次成交对应的上一批次')
        return
      }
      const nextRecords = currentAccount.tradeRecords.filter((item) => item.id !== tradeId)
      const previousTrades = nextRecords
        .filter((item) => tradeReferencesBatch(item, previousBatch.id))
        .sort((left, right) => left.tradedAt.localeCompare(right.tradedAt))
      const validationError = validateTBatchTrades(previousBatch, previousTrades)
      if (validationError) {
        setError(validationError)
        return
      }
      const { settlement: _settlement, ...unsettledBatch } = previousBatch
      const restoredBatch = rebalanceTBatchPlans(
        unsettledBatch,
        previousTrades,
        planDefaults,
        market
      )
      if (
        !applyTradeAccount(
          withLedgerTradeRecords(
            {
              ...currentAccount,
              activeBatch: restoredBatch,
              history: currentAccount.history.filter((item) => item.id !== previousBatch.id)
            },
            nextRecords
          )
        )
      )
        return
      resetTradeForm()
      return
    }
    const nextTrades = activeTrades.filter((trade) => trade.id !== tradeId)
    const validationError = validateTBatchTrades(batch, nextTrades)
    if (validationError) {
      setError(validationError)
      return
    }
    const plannedBatch = rebalanceTBatchPlans(batch, nextTrades, planDefaults, market)
    const hasTTrades = nextTrades.some((trade) => hasTAllocationForBatch(trade, plannedBatch.id))
    const nextRecords = currentAccount.tradeRecords.filter((record) => record.id !== tradeId)
    if (
      !applyTradeAccount(
        withLedgerTradeRecords(
          {
            ...currentAccount,
            activeBatch: hasTTrades ? plannedBatch : undefined
          },
          hasTTrades ? nextRecords : detachTradeRecordsFromBatch(nextRecords, plannedBatch.id)
        )
      )
    )
      return
    if (editingTradeId === tradeId) resetTradeForm()
  }

  const updatePlanLevel = (
    side: TAlertSide,
    index: number,
    key: 'targetPercent' | 'quantity',
    value: number
  ) => {
    const batch = currentAccount.activeBatch
    if (!batch) return
    if (market !== 'CN' && key === 'quantity') {
      if (!Number.isInteger(value) || value < 0) {
        setPlanError('计划数量须为非负整数股')
        return
      }
      const closingSide = isReverseBatch ? 'buy' : 'sell'
      if (side === closingSide) {
        const levels = side === 'buy' ? (batch.buyLevels ?? []) : batch.sellLevels
        const currentPlannedQuantity = levels.reduce((sum, level) => sum + level.quantity, 0)
        const plannedQuantity = levels.reduce(
          (sum, level, levelIndex) => sum + (levelIndex === index ? value : level.quantity),
          0
        )
        if (
          plannedQuantity > activeMetrics.remainingQuantity &&
          plannedQuantity >= currentPlannedQuantity
        ) {
          setPlanError(
            `平仓侧计划合计不能超过当前 T 仓 ${formatShares(activeMetrics.remainingQuantity)} 股`
          )
          return
        }
      }
    }
    setPlanError('')
    const nextBatch = updateTPlanLevel(batch, side, index, key, value)
    applyAccount(
      {
        ...currentAccount,
        activeBatch: nextBatch.alertEnabled
          ? applyTAlertTriggers(nextBatch, activeTrades, quote?.latest, {
              market,
              instrumentType: stock.instrumentType
            }).batch
          : nextBatch
      },
      stock.position
    )
  }

  const resetPlanLevels = () => {
    const batch = currentAccount.activeBatch
    if (!batch) return
    const nextBatch = resetTBatchPlans(batch, activeTrades, planDefaults, market)
    setPlanError('')
    applyAccount(
      {
        ...currentAccount,
        activeBatch: nextBatch.alertEnabled
          ? applyTAlertTriggers(nextBatch, activeTrades, quote?.latest, {
              market,
              instrumentType: stock.instrumentType
            }).batch
          : nextBatch
      },
      stock.position
    )
  }

  const updateBoardLotSize = (rawValue: string) => {
    const boardLotSize = rawValue === '' ? undefined : Number(rawValue)
    if (boardLotSize !== undefined && (!Number.isInteger(boardLotSize) || boardLotSize <= 0)) {
      setPlanError('每手股数须为正整数')
      return
    }
    setPlanError('')
    applyAccount({ ...currentAccount, boardLotSize }, stock.position)
  }

  const togglePriceAlerts = () => {
    const batch = currentAccount.activeBatch
    if (!batch) return
    const nextBatch = setTAlertEnabled(batch, !batch.alertEnabled)
    applyAccount(
      {
        ...currentAccount,
        activeBatch: nextBatch.alertEnabled
          ? applyTAlertTriggers(nextBatch, activeTrades, quote?.latest, {
              market,
              instrumentType: stock.instrumentType
            }).batch
          : nextBatch
      },
      stock.position
    )
  }

  const toggleFloatingProfitAlerts = () => {
    const batch = currentAccount.activeBatch
    if (!batch) return
    const normalizedBatch = batch.floatingProfitAlert
      ? batch
      : {
          ...batch,
          floatingProfitAlert: {
            enabled: false,
            threshold: floatingProfitAlertDefaultThreshold,
            status: 'armed' as const
          }
        }
    const floatingAlert = normalizedBatch.floatingProfitAlert
    if (!floatingAlert) return
    const nextBatch = setTFloatingProfitAlertEnabled(normalizedBatch, !floatingAlert.enabled)
    applyAccount({ ...currentAccount, activeBatch: nextBatch }, stock.position)
  }

  const updateFloatingProfitAlertThreshold = (value: number) => {
    const batch = currentAccount.activeBatch
    if (!batch) return
    const normalizedBatch = batch.floatingProfitAlert
      ? batch
      : {
          ...batch,
          floatingProfitAlert: {
            enabled: false,
            threshold: floatingProfitAlertDefaultThreshold,
            status: 'armed' as const
          }
        }
    applyAccount(
      {
        ...currentAccount,
        activeBatch: setTFloatingProfitAlertThreshold(normalizedBatch, value)
      },
      stock.position
    )
  }

  const handlePlanAlert = (side: TAlertSide, index?: number) => {
    const batch = currentAccount.activeBatch
    if (!batch) return
    applyAccount(
      {
        ...currentAccount,
        activeBatch: handleTPlanAlert(batch, side, index)
      },
      stock.position
    )
  }

  const restorePlanAlert = (side: TAlertSide, index: number) => {
    const batch = currentAccount.activeBatch
    if (!batch) return
    const nextBatch = restoreTPlanAlert(batch, side, index)
    applyAccount(
      {
        ...currentAccount,
        activeBatch: nextBatch.alertEnabled
          ? applyTAlertTriggers(nextBatch, activeTrades, quote?.latest, {
              market,
              instrumentType: stock.instrumentType
            }).batch
          : nextBatch
      },
      stock.position
    )
  }

  const settleBatch = () => {
    const batch = currentAccount.activeBatch
    if (!batch || activeMetrics.remainingQuantity !== 0) return

    const finalQuantity = Math.max(0, Number(latestPositionQuantity) || 0)
    const finalQuantityError =
      finalQuantity > 0 ? marketTradeQuantityError(market, finalQuantity) : undefined
    if (finalQuantityError) {
      setError(finalQuantityError)
      return
    }
    const hasLatestCost = latestPositionCost.trim() !== ''
    const finalCost = hasLatestCost ? Number(latestPositionCost) : undefined
    const settlementPositionError = validateTBatchSettlementPosition(finalQuantity, finalCost)
    if (settlementPositionError) {
      setError(settlementPositionError)
      return
    }

    const costAdjustedProfit =
      finalCost === undefined || holdingCostBasis === null || holdingCostBasis === undefined
        ? undefined
        : calculateCostAdjustedProfit(
            activeMetrics.realizedProfit,
            holdingCostBasis,
            finalQuantity,
            finalCost
          )
    const settlement = {
      settledAt: new Date().toISOString(),
      latestPositionQuantity: finalQuantity,
      latestPositionCost: finalCost,
      ledgerProfit: activeMetrics.realizedProfit,
      costAdjustedProfit,
      finalProfit: costAdjustedProfit ?? activeMetrics.realizedProfit,
      source: costAdjustedProfit === undefined ? ('ledger' as const) : ('position-cost' as const),
      note: settlementNote.trim()
    }
    let settledBatch: TTradingBatch = { ...batch, settlement }
    const nextPosition =
      finalQuantity > 0 && finalCost !== undefined
        ? {
            quantity: finalQuantity,
            cost: finalCost,
            openedToday: false,
            openedOn: stock.position?.openedOn ?? batch.openingPosition?.openedOn,
            currency,
            costExchangeRate: stock.position?.costExchangeRate,
            costExchangeRateDate: stock.position?.costExchangeRateDate
          }
        : undefined

    let settledAccount: TTradingAccount = {
      ...currentAccount,
      activeBatch: undefined,
      history: [settledBatch, ...currentAccount.history]
    }
    if (market === 'CN') {
      applyAccount(settledAccount, nextPosition)
    } else {
      const before = calculatePortfolioLedgerPosition(settledAccount, market, currency)
      if (before.error) {
        setError(`完整账本校验失败：${before.error}`)
        return
      }
      if (finalQuantity > 0 || (before.position?.quantity ?? 0) !== finalQuantity) {
        const calibratedPosition: StockPosition | undefined =
          finalQuantity > 0 && nextPosition
            ? {
                ...nextPosition,
                openedOn: before.position?.openedOn ?? nextPosition?.openedOn,
                costExchangeRate:
                  before.position?.costExchangeRate ?? nextPosition?.costExchangeRate,
                costExchangeRateDate:
                  before.position?.costExchangeRateDate ?? nextPosition?.costExchangeRateDate
              }
            : undefined
        const positionAdjustmentId = `position-adjustment:${crypto.randomUUID()}`
        settledAccount = appendPositionAdjustment(
          settledAccount,
          before.position,
          calibratedPosition,
          `${marketDateTimeInput(market)}:59`,
          settlement.settledAt,
          false,
          `T批次 #${batch.sequence} 结算成本校准`,
          positionAdjustmentId
        )
        settledBatch = {
          ...settledBatch,
          settlement: { ...settlement, positionAdjustmentId }
        }
        settledAccount = {
          ...settledAccount,
          history: [settledBatch, ...currentAccount.history]
        }
      }
      const after = calculatePortfolioLedgerPosition(settledAccount, market, currency)
      if (after.error) {
        setError(`完整账本校验失败：${after.error}`)
        return
      }
      applyAccount(settledAccount, after.position)
    }
    setHistoryPage(0)
    setSettlementNote('')
    setSettlementBatchId('')
    resetTradeForm()
  }

  const startEditingHistoryProfit = (batch: TTradingBatch) => {
    if (!batch.settlement) return
    setEditingHistoryCostBatchId(null)
    setEditingHistoryBatchId(batch.id)
    setHistoryProfitDraft(
      (batch.settlement.costAdjustedProfit ?? batch.settlement.finalProfit).toString()
    )
    setHistoryProfitError('')
  }

  const cancelEditingHistoryProfit = () => {
    setEditingHistoryBatchId(null)
    setHistoryProfitDraft('')
    setHistoryProfitError('')
  }

  const saveHistoryProfit = (batchId: string) => {
    if (historyProfitDraft.trim() === '') {
      setHistoryProfitError('请输入成本校准收益')
      return
    }
    const profit = Number(historyProfitDraft)
    if (!Number.isFinite(profit)) {
      setHistoryProfitError('请输入有效的收益金额')
      return
    }
    const roundedProfit = roundMoney(profit)
    const history = currentAccount.history.map((batch) => {
      if (batch.id !== batchId || !batch.settlement) return batch
      return {
        ...batch,
        settlement: {
          ...batch.settlement,
          costAdjustedProfit: roundedProfit,
          finalProfit: roundedProfit,
          source: 'position-cost' as const
        }
      }
    })
    applyAccount({ ...currentAccount, history }, stock.position)
    cancelEditingHistoryProfit()
  }

  const startEditingHistoryCost = (batch: TTradingBatch) => {
    if (batch.settlement?.latestPositionCost === undefined) return
    cancelEditingHistoryProfit()
    setEditingHistoryCostBatchId(batch.id)
    setHistoryCostDraft(batch.settlement.latestPositionCost.toString())
    setHistoryCostError('')
  }

  const cancelEditingHistoryCost = () => {
    setEditingHistoryCostBatchId(null)
    setHistoryCostDraft('')
    setHistoryCostError('')
  }

  const saveHistoryCost = (batch: TTradingBatch) => {
    const settlement = batch.settlement
    const adjustment = currentAccount.ledger.entries.find(
      (entry) => entry.id === settlement?.positionAdjustmentId
    )
    if (
      !settlement ||
      settlement.latestPositionCost === undefined ||
      adjustment?.kind !== 'positionAdjustment'
    ) {
      setHistoryCostError('未找到对应的结算成本账本记录')
      return
    }
    const cost = Number(historyCostDraft)
    if (historyCostDraft.trim() === '' || !Number.isFinite(cost) || cost < 0) {
      setHistoryCostError('请输入有效的券商最终持仓成本')
      return
    }
    const costAdjustedProfit =
      settlement.costAdjustedProfit === undefined
        ? undefined
        : roundMoney(
            settlement.costAdjustedProfit +
              (settlement.latestPositionCost - cost) * settlement.latestPositionQuantity
          )
    const history = currentAccount.history.map((item) =>
      item.id === batch.id
        ? {
            ...item,
            settlement: {
              ...settlement,
              latestPositionCost: cost,
              costAdjustedProfit,
              finalProfit: costAdjustedProfit ?? settlement.finalProfit
            }
          }
        : item
    )
    const nextAccount = appendPortfolioLedgerEntries({ ...currentAccount, history }, [
      { ...adjustment, costAfter: cost }
    ])
    const replay = calculatePortfolioLedgerPosition(nextAccount, market, currency)
    if (replay.error) {
      setHistoryCostError(`完整账本校验失败：${replay.error}`)
      return
    }
    applyAccount(nextAccount, replay.position)
    cancelEditingHistoryCost()
  }

  const deleteHistoryBatch = async (batch: TTradingBatch) => {
    if (
      currentAccount.tradeRecords.some(
        (record) => tradeReferencesBatch(record, batch.id) && spansMultipleBatches(record)
      )
    ) {
      setError('该历史批次与另一T批次由同一笔成交连接，不能单独删除')
      return
    }
    const confirmed = await confirm({
      title: '删除做T历史批次',
      message: `确定删除做T历史批次 #${batch.sequence} 吗？删除后无法恢复。`,
      confirmLabel: '删除批次',
      tone: 'danger'
    })
    if (!confirmed) return

    if (
      !applyTradeAccount(
        withLedgerTradeRecords(
          {
            ...currentAccount,
            ledger: {
              ...currentAccount.ledger,
              entries: currentAccount.ledger.entries.filter(
                (entry) => entry.id !== batch.settlement?.positionAdjustmentId
              )
            },
            history: currentAccount.history.filter((item) => item.id !== batch.id)
          },
          currentAccount.tradeRecords.filter((record) => !tradeReferencesBatch(record, batch.id))
        )
      )
    )
      return

    if (editingHistoryBatchId === batch.id) cancelEditingHistoryProfit()
    if (editingHistoryCostBatchId === batch.id) cancelEditingHistoryCost()
  }

  const feeInput = (key: keyof TTradeFees, label: string) => (
    <label>
      <span>{label}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={feeOverrides[key]}
        onChange={(event) =>
          setFeeOverrides((current) => ({
            ...current,
            [key]: Math.max(0, Number(event.target.value) || 0)
          }))
        }
      />
    </label>
  )

  return createPortal(
    <div className="t-trading-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="t-trading-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="t-trading-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="t-trading-header">
          <div>
            <span className="t-trading-icon">
              <Repeat2 size={20} />
            </span>
            <span>
              <strong id="t-trading-title">交易管理 · {stock.name}</strong>
              <small>{stock.code} · 记录交易、目标价格与批次收益</small>
            </span>
          </div>
          <button
            className="icon-button dialog-close"
            type="button"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={19} />
          </button>
        </header>

        <div className="t-trading-content">
          <section className="t-overview-grid">
            <span>
              <small>总持仓</small>
              <strong>{formatOverviewValue(stock.position?.quantity, formatShares)}</strong>
            </span>
            <span>
              <small>持仓成本</small>
              <strong>{formatOverviewValue(holdingCost, formatCost)}</strong>
            </span>
            <span>
              <small>{isReverseBatch ? '待回补数量' : '当前T仓'}</small>
              <strong>{formatOverviewValue(activeMetrics.remainingQuantity, formatShares)}</strong>
            </span>
            <span>
              <small>{isReverseBatch ? '反T基准价' : 'T仓成本'}</small>
              <strong>{formatOverviewValue(activeMetrics.averageCost, formatCost)}</strong>
            </span>
            <span>
              <small>当前价格</small>
              <strong>{formatOverviewValue(quote?.latest, formatPrice)}</strong>
            </span>
            <span>
              <small>做T总收益</small>
              <strong className={valueClass(totalHistoryProfit)}>
                {formatOverviewValue(totalHistoryProfit, formatNativeProfit)}
              </strong>
            </span>
            <span className="t-overview-fee">
              <small>做T总费用</small>
              <strong>{formatOverviewValue(totalHistoryFees, formatNativeAmount)}</strong>
            </span>
          </section>

          <section className="t-card t-trade-entry">
            <div className="t-card-heading">
              <span>
                <strong>{editingTradeId ? '修改交易' : '录入交易'}</strong>
                <small>{entryHint}</small>
              </span>
              {editingTradeId ? (
                <button type="button" className="text-button" onClick={resetTradeForm}>
                  取消修改
                </button>
              ) : null}
            </div>

            <div className="t-entry-top-row">
              <div className="t-segmented">
                <button
                  className={entryMode === 'trade' && side === 'buy' ? 'is-active' : ''}
                  type="button"
                  disabled={hasFixedAllocations}
                  onClick={() => {
                    setEntryMode('trade')
                    setSide('buy')
                    setPurpose('t')
                    setCashError('')
                  }}
                >
                  买入
                </button>
                <button
                  className={entryMode === 'trade' && side === 'sell' ? 'is-active' : ''}
                  type="button"
                  disabled={hasFixedAllocations}
                  onClick={() => {
                    setEntryMode('trade')
                    setSide('sell')
                    setPurpose('t')
                    setCashError('')
                  }}
                >
                  卖出
                </button>
                <button
                  className={entryMode === 'trade' && purpose === 't' ? 'is-purpose-active' : ''}
                  type="button"
                  disabled={hasFixedAllocations}
                  onClick={() => {
                    setEntryMode('trade')
                    setPurpose('t')
                    setCashError('')
                  }}
                >
                  {tPurposeLabel}
                </button>
                <button
                  className={entryMode === 'trade' && purpose === 'base' ? 'is-purpose-active' : ''}
                  type="button"
                  disabled={hasFixedAllocations}
                  onClick={() => {
                    setEntryMode('trade')
                    setPurpose('base')
                    setCashError('')
                  }}
                >
                  {basePurposeLabel}
                </button>
                <button
                  className={entryMode === 'cash' ? 'is-purpose-active' : ''}
                  type="button"
                  disabled={Boolean(editingTradeId)}
                  onClick={() => {
                    setEntryMode('cash')
                    setCashError('')
                    setError('')
                  }}
                >
                  分红与缴税
                </button>
              </div>

              {entryMode === 'trade' ? (
                <>
                  <div className="t-fee-summary">
                    {market === 'CN' ? (
                      <>
                        <span>佣金 {formatCurrency(tradeFees.commission)}</span>
                        <span>经手 {formatCurrency(tradeFees.handling)}</span>
                        <span>证管 {formatCurrency(tradeFees.regulatory)}</span>
                        <span>过户 {formatCurrency(tradeFees.transfer)}</span>
                        <span>印花税 {formatCurrency(tradeFees.stampDuty)}</span>
                      </>
                    ) : (
                      <>
                        {tradeFeeItems?.map((item) => (
                          <span key={item.code}>
                            {item.label} {formatNativeAmount(item.amount)}
                          </span>
                        ))}
                        {!manualFees && !marketFeeTemplate ? (
                          <span>当前成交日期无内置费用模板</span>
                        ) : null}
                        <span>
                          {manualFees
                            ? preservesUnknownFeeSource
                              ? '费用来源未标记'
                              : '券商实际费用'
                            : `模板估算${selectedFeeTemplate ? ` · v${selectedFeeTemplate.version}` : ''}`}
                        </span>
                      </>
                    )}
                    <strong>合计 {formatNativeAmount(tradeFeeTotal)}</strong>
                  </div>
                  <button
                    type="button"
                    className="bordered-text-button text-button"
                    onClick={() => {
                      if (!manualFees) {
                        if (market === 'CN') setFeeOverrides(calculatedFees)
                        else setActualFees(tradeFeeTotal.toString())
                      }
                      setFeeModeEdited(true)
                      setManualFees((current) => !current)
                    }}
                  >
                    {manualFees ? '恢复自动计算' : '手动修改费用'}
                  </button>
                </>
              ) : null}
            </div>

            {entryMode === 'cash' ? (
              <>
                <div className="t-segmented t-cash-entry-kind">
                  <button
                    className={cashEntryKind === 'cashDividend' ? 'is-active' : ''}
                    type="button"
                    onClick={() => {
                      setCashEntryKind('cashDividend')
                      setCashError('')
                    }}
                  >
                    分红
                  </button>
                  <button
                    className={cashEntryKind === 'withholdingTax' ? 'is-active' : ''}
                    type="button"
                    onClick={() => {
                      setCashEntryKind('withholdingTax')
                      setCashError('')
                    }}
                  >
                    缴税
                  </button>
                </div>

                <div className="t-entry-input-row">
                  <div className="t-form-grid t-cash-entry-grid">
                    <label>
                      <span>{cashEntryKind === 'cashDividend' ? '税前分红金额' : '缴税金额'}</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={cashAmount}
                        onChange={(event) => setCashAmount(event.target.value)}
                      />
                    </label>
                    {cashEntryKind === 'cashDividend' ? (
                      <label>
                        <span>登记股数（可选）</span>
                        <input
                          type="number"
                          min="0"
                          step="100"
                          value={cashEligibleQuantity}
                          onChange={(event) => setCashEligibleQuantity(event.target.value)}
                        />
                      </label>
                    ) : null}
                    <label>
                      <span>发生时间</span>
                      <input
                        type="datetime-local"
                        value={cashOccurredAt}
                        onChange={(event) => setCashOccurredAt(event.target.value)}
                      />
                    </label>
                    {currency !== 'CNY' ? (
                      <label>
                        <span>兑人民币汇率（可选）</span>
                        <input
                          type="number"
                          min="0.000001"
                          step="0.000001"
                          value={cashExchangeRateInput}
                          onChange={(event) => {
                            setCashExchangeRateInput(event.target.value)
                            setCashExchangeRateEdited(true)
                          }}
                          placeholder="未知时留空"
                        />
                      </label>
                    ) : null}
                    <label className={cashEntryKind === 'withholdingTax' ? 'is-wide' : ''}>
                      <span>备注</span>
                      <input
                        value={cashNote}
                        onChange={(event) => setCashNote(event.target.value)}
                        placeholder="可选"
                      />
                    </label>
                  </div>

                  <div className="t-entry-actions">
                    <span>
                      {cashEntryKind === 'cashDividend'
                        ? Number(cashEligibleQuantity) > 0 && Number(cashAmount) > 0
                          ? `每股分红 ${formatNativeAmount(
                              Number(cashAmount) / Number(cashEligibleQuantity)
                            )}`
                          : '按税前总额计入分红收入'
                        : '缴税按现金流出计入收益统计'}
                    </span>
                    <button
                      className="primary-button compact-button"
                      type="button"
                      onClick={saveCashEntry}
                    >
                      <Plus size={15} />
                      {cashEntryKind === 'cashDividend' ? '记录分红' : '记录缴税'}
                    </button>
                  </div>
                </div>

                {cashError ? <div className="t-form-error">{cashError}</div> : null}
              </>
            ) : (
              <>
                <div className="t-entry-input-row">
                  <div className="t-form-grid">
                    <label>
                      <span>成交价格</span>
                      <input
                        type="number"
                        min={market === 'CN' ? 0.01 : 0.0001}
                        step={market === 'CN' ? 0.01 : 0.0001}
                        value={price}
                        onChange={(event) => setPrice(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>成交数量</span>
                      <input
                        type="number"
                        min={market === 'CN' ? 100 : 1}
                        step="100"
                        value={quantity}
                        disabled={hasFixedAllocations}
                        onChange={(event) => setQuantity(event.target.value)}
                      />
                    </label>
                    {currency !== 'CNY' ? (
                      <label>
                        <span>成交汇率（可选）</span>
                        <input
                          type="number"
                          min="0.000001"
                          step="0.000001"
                          value={tradeExchangeRate}
                          onChange={(event) => {
                            setTradeExchangeRate(event.target.value)
                            setTradeExchangeRateEdited(true)
                          }}
                          placeholder="未知时留空"
                        />
                      </label>
                    ) : null}
                    <label>
                      <span>成交时间</span>
                      <input
                        type="datetime-local"
                        value={tradedAt}
                        onChange={(event) => setTradedAt(event.target.value)}
                      />
                    </label>
                    {market !== 'CN' ? (
                      <label>
                        <span>实际交收日（可选）</span>
                        <input
                          type="date"
                          value={actualSettlementDate}
                          onChange={(event) => setActualSettlementDate(event.target.value)}
                        />
                      </label>
                    ) : null}
                    <label>
                      <span>备注</span>
                      <input
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder="可选"
                      />
                    </label>
                  </div>

                  <div className="t-entry-actions">
                    <span>
                      成交额 {formatNativeAmount(numericPrice * numericQuantity)}
                      {market !== 'CN' && tradedAt
                        ? ` · 预计交收 ${
                            estimateSettlementDate(market, tradeDate, tradingCalendar) || '--'
                          }`
                        : ''}
                    </span>
                    <button
                      className="primary-button compact-button"
                      type="button"
                      onClick={saveTrade}
                    >
                      <Plus size={15} />
                      {editingTradeId ? '保存修改' : '记录交易'}
                    </button>
                  </div>
                </div>

                {overflowQuantity > 0 ? (
                  <div className="t-overflow-allocation">
                    <span>
                      <strong>本次成交跨越当前T仓</strong>
                      <small>
                        成交时可用T仓 {formatShares(entryMetrics.remainingQuantity)}，超出{' '}
                        {formatShares(overflowQuantity)}
                      </small>
                    </span>
                    <div className="t-overflow-options">
                      <button
                        type="button"
                        className={overflowDisposition === 'base' ? 'is-selected' : ''}
                        onClick={() => setOverflowDisposition('base')}
                      >
                        {side === 'sell' ? '减持底仓' : '增加底仓'}
                      </button>
                      <button
                        type="button"
                        className={overflowDisposition === 'opposite-t' ? 'is-selected' : ''}
                        onClick={() => setOverflowDisposition('opposite-t')}
                      >
                        {activeMetrics.direction === 'forward' ? '开启反T批次' : '开启正T批次'}
                      </button>
                    </div>
                    <small>
                      保存后生成两条独立记录：本批次 {formatShares(entryMetrics.remainingQuantity)}
                      ，
                      {overflowDisposition === 'base'
                        ? `混合底仓流水（${basePurposeLabel}）`
                        : activeMetrics.direction === 'forward'
                          ? '新反T批次'
                          : '新正T批次'}{' '}
                      {formatShares(overflowQuantity)}。手续费按整笔计算一次，再按数量分摊。
                    </small>
                  </div>
                ) : null}

                {manualFees ? (
                  <div className="t-fee-inputs">
                    {market === 'CN' ? (
                      <>
                        {feeInput('commission', '佣金')}
                        {feeInput('handling', '经手费')}
                        {feeInput('regulatory', '证管费')}
                        {feeInput('transfer', '过户费')}
                        {feeInput('stampDuty', '印花税')}
                      </>
                    ) : (
                      <label>
                        <span>券商实际费用</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={actualFees}
                          onChange={(event) => {
                            setActualFees(event.target.value)
                            setFeeModeEdited(true)
                          }}
                          placeholder="零费用请填写 0"
                        />
                      </label>
                    )}
                  </div>
                ) : null}

                {error ? <div className="t-form-error">{error}</div> : null}
              </>
            )}
          </section>

          {baseLedgerEntriesDescending.length > 0 ? (
            <section
              className={`t-card t-base-ledger-card${
                currentAccount.activeBatch ? '' : ' is-full-width'
              }`}
            >
              <div className="t-card-heading">
                <span>
                  <strong>底仓流水</strong>
                  <small>底仓交易及分红缴税均不归属 T 批次，现金流水不改变持仓数量和成本</small>
                </span>
                <div className="t-batch-summary">
                  {cashLedgerEntriesDescending.length > 0 ? (
                    <span>
                      <small>现金净收入</small>
                      <strong className={valueClass(cashLedgerNetAmount)}>
                        {formatNativeProfit(cashLedgerNetAmount)}
                      </strong>
                    </span>
                  ) : null}
                  <em>{baseLedgerEntriesDescending.length} 笔流水</em>
                </div>
              </div>
              <div className="t-trade-list">
                {visibleBaseLedgerEntries.map((item) => {
                  if (item.kind === 'cash') {
                    const { entry } = item
                    const signedAmount = cashLedgerAmount(entry)
                    const isDeletable =
                      entry.source !== 'corporateAction' && !entry.corporateActionId
                    return (
                      <div className="t-trade-row" key={entry.id}>
                        <span
                          className={`t-trade-side ${
                            entry.kind === 'cashDividend' ? 'is-buy' : 'is-sell'
                          }`}
                        >
                          {entry.kind === 'cashDividend' ? '分红' : '缴税'}
                        </span>
                        <span>
                          <strong>
                            {entry.kind === 'cashDividend' && entry.eligibleQuantity > 0
                              ? `${formatShares(entry.eligibleQuantity)} · 每股 ${formatNativeAmount(
                                  entry.amountPerShare
                                )}`
                              : entry.kind === 'cashDividend'
                                ? '税前分红'
                                : '预扣税款'}
                          </strong>
                          <small>
                            {formatTradeTime(entry.occurredAt)} · {cashLedgerSourceLabel(entry)}
                          </small>
                        </span>
                        <span className="t-trade-amount">
                          <strong className={valueClass(signedAmount)}>
                            {formatNativeProfit(signedAmount)}
                          </strong>
                          <small>
                            {entry.note || (entry.kind === 'cashDividend' ? '现金分红' : '缴税')}
                          </small>
                        </span>
                        <span className="t-trade-actions">
                          <button
                            className="icon-button"
                            type="button"
                            disabled={!isDeletable}
                            onClick={() => deleteCashEntry(entry)}
                            title={isDeletable ? '删除现金流水' : '请在公司行动中撤销'}
                          >
                            <Trash2 size={14} />
                          </button>
                        </span>
                      </div>
                    )
                  }

                  const { trade } = item
                  const fees = totalRecordedTradeFees(trade)
                  return (
                    <div className="t-trade-row" key={trade.id}>
                      <span className={`t-trade-side is-${trade.side}`}>
                        {trade.side === 'buy' ? '底仓买入' : '底仓卖出'}
                      </span>
                      <span>
                        <strong>
                          {formatShares(trade.quantity)} × {formatPrice(trade.price)}
                        </strong>
                        <small>
                          {formatTradeTime(trade.tradedAt)} · 费用 {formatNativeAmount(fees)}
                          {market !== 'CN' ? ` · ${tradeFeeSourceLabel(trade)}` : ''}
                        </small>
                        {market !== 'CN' ? (
                          <small>
                            {trade.actualSettlementDate
                              ? `实际交收 ${trade.actualSettlementDate}`
                              : `预计交收 ${trade.estimatedSettlementDate ?? '--'}`}
                          </small>
                        ) : null}
                        {trade.splitSource ? (
                          <small>
                            <TradeSplitSource trade={trade} />
                          </small>
                        ) : null}
                      </span>
                      <span className="t-trade-amount">
                        <span>{formatNativeAmount(trade.price * trade.quantity)}</span>
                        <small>
                          {trade.splitSource
                            ? `混合底仓流水${trade.note ? ` · ${trade.note}` : ''}`
                            : trade.note || '底仓流水'}
                        </small>
                      </span>
                      <span className="t-trade-actions">
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => editTrade(trade)}
                          title="修改底仓交易"
                        >
                          <PencilLine size={14} />
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => deleteTrade(trade.id)}
                          title="删除底仓交易"
                        >
                          <Trash2 size={14} />
                        </button>
                      </span>
                    </div>
                  )
                })}
                {baseLedgerEntriesDescending.length > 5 ? (
                  <button
                    className="t-trade-more-button"
                    type="button"
                    onClick={() => setShowAllBaseLedgerEntries((current) => !current)}
                  >
                    {showAllBaseLedgerEntries
                      ? '收起底仓流水'
                      : `显示更多底仓流水（其余 ${baseLedgerEntriesDescending.length - 5} 条）`}
                  </button>
                ) : null}
              </div>
              {cashError && entryMode !== 'cash' ? (
                <div className="t-form-error">{cashError}</div>
              ) : null}
            </section>
          ) : null}

          {currentAccount.activeBatch ? (
            <>
              <section
                className={`t-card t-active-batch-card ${
                  baseLedgerEntriesDescending.length === 0 ? 'is-full-width' : ''
                }`}
              >
                <div className="t-card-heading">
                  <span>
                    <strong>
                      {batchDirectionLabel(currentAccount.activeBatch)}批次 #
                      {currentAccount.activeBatch.sequence}
                    </strong>
                    <small>
                      {isReverseBatch ? '先卖后买 · ' : '先买后卖 · '}
                      开始于 {formatTradeTime(currentAccount.activeBatch.openedAt)}
                    </small>
                  </span>
                  <div className="t-batch-summary">
                    <span>
                      <small>浮动收益</small>
                      <strong className={valueClass(activeMetrics.floatingProfit)}>
                        {formatNativeProfit(activeMetrics.floatingProfit)}
                        <small
                          className={`t-floating-profit-rate ${valueClass(activeMetrics.floatingProfitRate)}`}
                        >
                          ({formatPercent(activeMetrics.floatingProfitRate)})
                        </small>
                      </strong>
                    </span>
                    <span>
                      <small>当前批次收益</small>
                      <strong className={valueClass(activeMetrics.realizedProfit)}>
                        {formatNativeProfit(activeMetrics.realizedProfit)}
                      </strong>
                    </span>
                    <span>
                      <small>当前批次费用</small>
                      <strong>{formatNativeAmount(currentBatchFees)}</strong>
                    </span>
                    <em>{activeTrades.length} 笔流水</em>
                  </div>
                </div>
                {activeCnyMetrics ? (
                  <div className="t-batch-cny-summary">
                    <span>
                      <small>人民币已实现</small>
                      <strong className={valueClass(activeCnyMetrics.realizedProfit)}>
                        {formatMoneyProfit(activeCnyMetrics.realizedProfit, 'CNY')}
                      </strong>
                    </span>
                    <span>
                      <small>人民币浮动</small>
                      <strong className={valueClass(activeCnyMetrics.floatingProfit)}>
                        {formatMoneyProfit(activeCnyMetrics.floatingProfit, 'CNY')}
                      </strong>
                    </span>
                    <span>
                      <small>人民币合计</small>
                      <strong className={valueClass(activeCnyMetrics.totalProfit)}>
                        {formatMoneyProfit(activeCnyMetrics.totalProfit, 'CNY')}
                      </strong>
                    </span>
                    <span>
                      <small>本币收益折算 / 汇率贡献</small>
                      <strong className={valueClass(activeCnyMetrics.priceContribution)}>
                        {formatMoneyProfit(activeCnyMetrics.priceContribution, 'CNY')} /{' '}
                      </strong>
                      <strong className={valueClass(activeCnyMetrics.exchangeRateContribution)}>
                        {formatMoneyProfit(activeCnyMetrics.exchangeRateContribution, 'CNY')}
                      </strong>
                    </span>
                    <small className="t-batch-cny-note">
                      按成交记录汇率及当前汇率估算
                      {activeCnyIssue ? `；${activeCnyIssue}，待补录后显示完整人民币结果` : ''}
                    </small>
                  </div>
                ) : null}
                {currentAccount.activeBatch.floatingProfitAlert ? (
                  <div className="t-floating-profit-alert-settings">
                    <span>
                      <strong>浮动盈亏提醒</strong>
                      <small>达到 +阈值或 -阈值时提醒，回到区间后自动恢复</small>
                    </span>
                    <span className="t-floating-profit-alert-actions">
                      <label className="t-alert-toggle">
                        <span>启用</span>
                        <input
                          type="checkbox"
                          checked={currentAccount.activeBatch.floatingProfitAlert.enabled}
                          onChange={toggleFloatingProfitAlerts}
                          aria-label="启用浮动盈亏提醒"
                        />
                        <i aria-hidden="true" />
                      </label>
                      <label className="t-floating-profit-alert-threshold">
                        <span>阈值</span>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={currentAccount.activeBatch.floatingProfitAlert.threshold}
                          onChange={(event) =>
                            updateFloatingProfitAlertThreshold(Number(event.target.value))
                          }
                          aria-label="浮动盈亏提醒阈值"
                        />
                        <em>{currency === 'CNY' ? '元' : currency}</em>
                      </label>
                      <TFloatingProfitAlertBadge
                        batch={currentAccount.activeBatch}
                        floatingProfit={activeMetrics.floatingProfit}
                        currency={currency}
                      />
                    </span>
                  </div>
                ) : null}
                <div className="t-trade-list">
                  {visibleActiveTrades.map((trade) => {
                    const allocation = getTradeBatchAllocationAmounts(
                      trade,
                      currentAccount.activeBatch!
                    )
                    const summary = allocationSummary(trade, currentAccount.activeBatch!)
                    return (
                      <div className="t-trade-row" key={trade.id}>
                        <span className={`t-trade-side is-${trade.side}`}>
                          {tradeLabel(trade, currentAccount.activeBatch)}
                        </span>
                        <span>
                          <strong>
                            {formatShares(allocation.quantity)} × {formatPrice(trade.price)}
                          </strong>
                          <small>
                            {formatTradeTime(trade.tradedAt)} · 费用{' '}
                            {formatNativeAmount(allocation.fees)}
                            {market !== 'CN' ? ` · ${tradeFeeSourceLabel(trade)}` : ''}
                            {summary ? ` · ${summary}` : ''}
                          </small>
                          {market !== 'CN' ? (
                            <small>
                              {trade.actualSettlementDate
                                ? `实际交收 ${trade.actualSettlementDate}`
                                : `预计交收 ${trade.estimatedSettlementDate ?? '--'}`}
                            </small>
                          ) : null}
                          {trade.splitSource ? (
                            <small>
                              <TradeSplitSource trade={trade} />
                            </small>
                          ) : null}
                        </span>
                        <span className="t-trade-amount">
                          <span>{formatNativeAmount(trade.price * allocation.quantity)}</span>
                          <small>
                            {trade.side === 'buy' ? '含费成本' : '净到账'}{' '}
                            {formatNativeAmount(
                              trade.price * allocation.quantity +
                                (trade.side === 'buy' ? 1 : -1) * allocation.fees
                            )}
                          </small>
                        </span>
                        <span className="t-trade-actions">
                          <button
                            className="icon-button"
                            type="button"
                            disabled={spansMultipleBatches(trade)}
                            onClick={() => editTrade(trade)}
                            title={
                              spansMultipleBatches(trade)
                                ? '跨批次成交请删除后重新录入'
                                : '修改交易'
                            }
                          >
                            <PencilLine size={14} />
                          </button>
                          <button
                            className="icon-button"
                            type="button"
                            onClick={() => deleteTrade(trade.id)}
                            title="删除交易"
                          >
                            <Trash2 size={14} />
                          </button>
                        </span>
                      </div>
                    )
                  })}
                  {activeTradesDescending.length > 5 ? (
                    <button
                      className="t-trade-more-button"
                      type="button"
                      onClick={() => setShowAllActiveTrades((current) => !current)}
                    >
                      {showAllActiveTrades
                        ? '收起当前批次流水'
                        : `显示更多当前批次流水（其余 ${activeTradesDescending.length - 5} 条）`}
                    </button>
                  ) : null}
                </div>
              </section>

              {activeMetrics.remainingQuantity > 0 ? (
                <section className="t-card t-dual-plan-card">
                  <div className="t-card-heading">
                    <span>
                      <strong>当前T仓双五档计划</strong>
                      <small>
                        {isReverseBatch
                          ? '买入侧显示回补收益，卖出侧显示继续反T后的仓位与成本'
                          : '买入侧显示加仓后的仓位与成本，卖出侧显示价差收益'}
                      </small>
                      {market !== 'CN' ? (
                        <small>
                          按整数股规划，预计收益以 {currency} 按当前费用模板估算
                          {market === 'HK' ? '；ETF 特殊价位及每手股数请核对券商' : ''}
                        </small>
                      ) : null}
                    </span>
                    <span className="t-plan-heading-actions">
                      <label className="t-alert-toggle">
                        <span>价格提醒</span>
                        <input
                          type="checkbox"
                          checked={Boolean(currentAccount.activeBatch?.alertEnabled)}
                          onChange={togglePriceAlerts}
                        />
                        <i aria-hidden="true" />
                      </label>
                      <button type="button" className="text-button" onClick={resetPlanLevels}>
                        <RefreshCcw size={13} /> 重置双五档
                      </button>
                    </span>
                  </div>
                  {market === 'HK' ? (
                    <div className="t-plan-market-options">
                      <label>
                        <span>每手股数（自填）</span>
                        <input
                          type="number"
                          min="1"
                          step="100"
                          value={currentAccount.boardLotSize ?? ''}
                          onChange={(event) => updateBoardLotSize(event.target.value)}
                          placeholder="未填写"
                        />
                      </label>
                      {hasOddLotPlan ? (
                        <span>当前计划含碎股档位，请核对券商碎股交易方式</span>
                      ) : null}
                    </div>
                  ) : null}
                  {closingPlanOverAllocated ? (
                    <div className="t-form-error">
                      平仓侧计划合计 {formatShares(closingPlanQuantity)} 股，超过当前 T 仓{' '}
                      {formatShares(activeMetrics.remainingQuantity)} 股；请调整数量或重置双五档
                    </div>
                  ) : null}
                  {planError ? <div className="t-form-error">{planError}</div> : null}
                  <div className="t-plan-scroll">
                    <div className="t-plan-grid">
                      <TPlanTable
                        side="buy"
                        rows={buyLevelRows}
                        currency={currency}
                        minimumQuantity={market === 'CN' ? 100 : 1}
                        alertEnabled={Boolean(currentAccount.activeBatch?.alertEnabled)}
                        emphasized={isReverseBatch}
                        openingPlan={!isReverseBatch}
                        onUpdateLevel={(index, key, value) =>
                          updatePlanLevel('buy', index, key, value)
                        }
                        onHandleAlert={(index) => handlePlanAlert('buy', index)}
                        onRestoreAlert={(index) => restorePlanAlert('buy', index)}
                      />
                      <TPlanTable
                        side="sell"
                        rows={sellLevelRows}
                        currency={currency}
                        minimumQuantity={market === 'CN' ? 100 : 1}
                        alertEnabled={Boolean(currentAccount.activeBatch?.alertEnabled)}
                        emphasized={!isReverseBatch}
                        openingPlan={isReverseBatch}
                        onUpdateLevel={(index, key, value) =>
                          updatePlanLevel('sell', index, key, value)
                        }
                        onHandleAlert={(index) => handlePlanAlert('sell', index)}
                        onRestoreAlert={(index) => restorePlanAlert('sell', index)}
                      />
                    </div>
                  </div>
                </section>
              ) : null}

              {readyToSettle ? (
                <section className="t-card t-settlement-card">
                  <div className="t-card-heading">
                    <span>
                      <strong>{isReverseBatch ? '本批次反T已回补完成' : '本批次T仓已清空'}</strong>
                      <small>填写券商最新持仓成本后，以成本推算收益作为最终结果</small>
                    </span>
                    <CheckCircle2 size={20} />
                  </div>
                  <div className="t-settlement-preview">
                    <span>
                      <small>流水收益</small>
                      <strong className={valueClass(activeMetrics.realizedProfit)}>
                        {formatNativeProfit(activeMetrics.realizedProfit)}
                      </strong>
                    </span>
                    <span>
                      <small>买入总额</small>
                      <strong>{formatNativeAmount(activeMetrics.buyAmount)}</strong>
                    </span>
                    <span>
                      <small>卖出总额</small>
                      <strong>{formatNativeAmount(activeMetrics.sellAmount)}</strong>
                    </span>
                  </div>
                  <div className="t-form-grid">
                    <label>
                      <span>最新持仓数量</span>
                      <input
                        type="number"
                        min="0"
                        step="100"
                        value={latestPositionQuantity}
                        onChange={(event) => setLatestPositionQuantity(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>最新持仓成本</span>
                      <input
                        type="number"
                        step="0.0001"
                        value={latestPositionCost}
                        onChange={(event) => setLatestPositionCost(event.target.value)}
                        placeholder="留空则采用流水收益"
                      />
                    </label>
                    <label className="is-wide">
                      <span>结算备注</span>
                      <input
                        value={settlementNote}
                        onChange={(event) => setSettlementNote(event.target.value)}
                      />
                    </label>
                  </div>
                  {settlementPreviewProfit !== null ? (
                    <div className="t-cost-profit-preview">
                      按最新成本推算：
                      <strong className={valueClass(settlementPreviewProfit)}>
                        {formatNativeProfit(settlementPreviewProfit)}
                      </strong>
                    </div>
                  ) : null}
                  <div className="t-entry-actions">
                    <span>结算后，下一笔计入T仓的交易将创建新批次</span>
                    <button
                      className="primary-button compact-button"
                      type="button"
                      onClick={settleBatch}
                    >
                      确认结算并归档
                    </button>
                  </div>
                </section>
              ) : null}
            </>
          ) : null}

          {currentAccount.history.length > 0 ? (
            <section className="t-card t-history-card">
              <div className="t-card-heading">
                <span>
                  <strong>做T历史</strong>
                  <small>共完成 {currentAccount.history.length} 个批次</small>
                </span>
                {historyPageCount > 1 ? (
                  <div className="t-history-pagination" aria-label="做T历史分页">
                    <button
                      type="button"
                      onClick={() => setHistoryPage((current) => Math.max(0, current - 1))}
                      disabled={currentHistoryPage === 0}
                    >
                      上一页
                    </button>
                    <span>
                      {currentHistoryPage + 1} / {historyPageCount}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setHistoryPage((current) => Math.min(historyPageCount - 1, current + 1))
                      }
                      disabled={currentHistoryPage === historyPageCount - 1}
                    >
                      下一页
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="t-history-list">
                {visibleHistoryBatches.map((batch) => {
                  const batchTrades = getBatchTrades(currentAccount, batch)
                  const lastTrade = batchTrades.at(-1)
                  const batchCnyMetrics =
                    market === 'CN'
                      ? null
                      : calculateTBatchCnyMetrics(batch, batchTrades, market, null, null)
                  const batchCnyIssue = batchCnyMetrics ? tBatchCnyIssue(batchCnyMetrics) : null
                  return (
                    <details key={batch.id}>
                      <summary>
                        <span>
                          <strong>
                            {batchDirectionLabel(batch)}批次 #{batch.sequence}
                          </strong>
                          <small>
                            {formatTradeTime(batch.openedAt)} 至{' '}
                            {lastTrade ? formatTradeTime(lastTrade.tradedAt) : '--'}
                          </small>
                        </span>
                        <span>
                          <small>
                            {batch.settlement?.source === 'position-cost'
                              ? '成本校准收益'
                              : '流水收益'}
                          </small>
                          <strong
                            className={`t-history-profit ${valueClass(batch.settlement?.finalProfit)}`}
                          >
                            {formatNativeProfit(batch.settlement?.finalProfit)}
                          </strong>
                        </span>
                      </summary>
                      <div>
                        {batchTrades.map((trade) => {
                          const allocation = getTradeBatchAllocationAmounts(trade, batch)
                          const totalFees = allocation.fees
                          const amountChange =
                            trade.side === 'buy'
                              ? -(trade.price * allocation.quantity + totalFees)
                              : trade.price * allocation.quantity - totalFees
                          const summary = allocationSummary(trade, batch)
                          return (
                            <span className="t-history-trade" key={trade.id}>
                              <b>{tradeLabel(trade, batch)}</b>
                              <span>
                                {formatTradeTime(trade.tradedAt)}
                                {market !== 'CN'
                                  ? ` · ${trade.actualSettlementDate ? `实际交收 ${trade.actualSettlementDate}` : `预计交收 ${trade.estimatedSettlementDate ?? '--'}`}`
                                  : ''}
                              </span>
                              <span>
                                {formatShares(allocation.quantity)} × {formatPrice(trade.price)}
                                {summary ? ` · ${summary}` : ''}
                                {trade.splitSource ? (
                                  <>
                                    {' '}
                                    · <TradeSplitSource trade={trade} />
                                  </>
                                ) : null}
                              </span>
                              <span>
                                分摊费用 {formatNativeAmount(totalFees)}
                                {market !== 'CN' ? ` · ${tradeFeeSourceLabel(trade)}` : ''}
                              </span>
                              <strong className={valueClass(amountChange)}>
                                金额变动 {formatNativeProfit(amountChange)}
                              </strong>
                            </span>
                          )
                        })}
                        {batch.settlement ? (
                          <div className="t-history-settlement">
                            <p>
                              流水收益{' '}
                              <strong className={valueClass(batch.settlement.ledgerProfit)}>
                                {formatNativeProfit(batch.settlement.ledgerProfit)}
                              </strong>
                              {batch.settlement.costAdjustedProfit !== undefined ? (
                                <>
                                  {' · 成本校准 '}
                                  <strong
                                    className={valueClass(batch.settlement.costAdjustedProfit)}
                                  >
                                    {formatNativeProfit(batch.settlement.costAdjustedProfit)}
                                  </strong>
                                </>
                              ) : null}
                              {batch.settlement.note ? ` · ${batch.settlement.note}` : ''}
                            </p>
                            {batchCnyMetrics ? (
                              <p>
                                流水人民币收益{' '}
                                <strong className={valueClass(batchCnyMetrics.realizedProfit)}>
                                  {formatMoneyProfit(batchCnyMetrics.realizedProfit, 'CNY')}
                                </strong>
                                {' · 本币收益折算 '}
                                <strong className={valueClass(batchCnyMetrics.priceContribution)}>
                                  {formatMoneyProfit(batchCnyMetrics.priceContribution, 'CNY')}
                                </strong>
                                {' · 汇率贡献 '}
                                <strong
                                  className={valueClass(batchCnyMetrics.exchangeRateContribution)}
                                >
                                  {formatMoneyProfit(
                                    batchCnyMetrics.exchangeRateContribution,
                                    'CNY'
                                  )}
                                </strong>
                                {batchCnyIssue ? ` · ${batchCnyIssue}` : ''}
                                {batch.settlement.source === 'position-cost'
                                  ? ' · 成本校准收益未折算'
                                  : ''}
                              </p>
                            ) : null}
                            {market !== 'CN' &&
                            batch.settlement.latestPositionCost !== undefined ? (
                              <p>
                                券商结算持仓 {formatShares(batch.settlement.latestPositionQuantity)}{' '}
                                × {formatCost(batch.settlement.latestPositionCost)}
                              </p>
                            ) : null}
                            {market !== 'CN' && editingHistoryCostBatchId === batch.id ? (
                              <div className="t-history-profit-editor">
                                <label>
                                  <span>券商最终持仓成本</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.0001"
                                    value={historyCostDraft}
                                    onChange={(event) => setHistoryCostDraft(event.target.value)}
                                  />
                                </label>
                                <button
                                  className="primary-button compact-button"
                                  type="button"
                                  onClick={() => saveHistoryCost(batch)}
                                >
                                  保存
                                </button>
                                <button
                                  className="text-button"
                                  type="button"
                                  onClick={cancelEditingHistoryCost}
                                >
                                  取消
                                </button>
                                {historyCostError ? <small>{historyCostError}</small> : null}
                              </div>
                            ) : null}
                            {editingHistoryBatchId === batch.id ? (
                              <div className="t-history-profit-editor">
                                <label>
                                  <span>成本校准收益</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={historyProfitDraft}
                                    onChange={(event) => setHistoryProfitDraft(event.target.value)}
                                    autoFocus
                                  />
                                </label>
                                <button
                                  className="primary-button compact-button"
                                  type="button"
                                  onClick={() => saveHistoryProfit(batch.id)}
                                >
                                  保存
                                </button>
                                <button
                                  className="text-button"
                                  type="button"
                                  onClick={cancelEditingHistoryProfit}
                                >
                                  取消
                                </button>
                                {historyProfitError ? <small>{historyProfitError}</small> : null}
                              </div>
                            ) : (
                              <div className="t-history-actions">
                                <button
                                  className="text-button t-history-edit-button"
                                  type="button"
                                  onClick={() => startEditingHistoryProfit(batch)}
                                >
                                  <PencilLine size={12} />
                                  修改成本校准收益
                                </button>
                                {market !== 'CN' && batch.settlement.positionAdjustmentId ? (
                                  <button
                                    className="text-button t-history-edit-button"
                                    type="button"
                                    onClick={() => startEditingHistoryCost(batch)}
                                  >
                                    <PencilLine size={12} />
                                    修改券商最终成本
                                  </button>
                                ) : null}
                                <button
                                  className="text-button t-history-delete-button"
                                  type="button"
                                  onClick={() => deleteHistoryBatch(batch)}
                                >
                                  <Trash2 size={12} />
                                  删除此批次
                                </button>
                              </div>
                            )}
                            {editingHistoryBatchId === batch.id ? (
                              <button
                                className="text-button t-history-delete-button"
                                type="button"
                                onClick={() => deleteHistoryBatch(batch)}
                              >
                                <Trash2 size={12} />
                                删除此批次
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </details>
                  )
                })}
              </div>
            </section>
          ) : null}
        </div>
      </aside>
    </div>,
    document.body
  )
}
