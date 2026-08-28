import { CheckCircle2, PencilLine, Plus, RefreshCcw, Repeat2, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  formatCost,
  formatCurrency,
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
  calculateCostAdjustedProfit,
  calculateTBatchMetrics,
  calculateTradeFees,
  createTPlanLevelsFromDefaults,
  getTBatchDirection,
  recalculatePositionFromBatch,
  rebalanceTBatchPlans,
  resetTBatchPlans,
  roundMoney,
  getTradeBatchAllocationAmounts,
  totalTradeFees,
  validateTBatchSettlementPosition,
  validateTBatchTrades
} from '../lib/t-trading'
import {
  detachTradeRecordsFromBatch,
  getTradeAllocations,
  getBatchTrades,
  hasTAllocationForBatch,
  isIndependentBaseTrade,
  tradeReferencesBatch,
  upsertTradeRecord
} from '../lib/trade-records'
import { calculatePortfolioLedgerPosition } from '../lib/portfolio-ledger'
import { deleteIndependentBaseTrade, upsertIndependentBaseTrade } from '../lib/base-trades'
import { TPlanTable } from './TPlanTable'
import { TFloatingProfitAlertBadge } from './TFloatingProfitAlertBadge'
import type {
  StockPosition,
  StockQuote,
  TPlanDefaultSettings,
  TTradeAllocation,
  TTradingAccount,
  TTradingBatch,
  TTradingFeeSettings,
  TTrade,
  TTradeFees,
  TTradePurpose,
  TTradeSide,
  WatchStock
} from '../shared/types'
import { withLedgerTradeRecords } from '../shared/types'
import { currencyForMarket, marketFromQuoteId } from '../shared/stock-market'
import { useConfirmDialog } from './ConfirmDialog'

interface TTradingDrawerProps {
  stock: WatchStock
  quote: StockQuote | undefined
  account: TTradingAccount | undefined
  feeSettings: TTradingFeeSettings
  planDefaults: TPlanDefaultSettings
  floatingProfitAlertDefaultThreshold: number
  onApply: (account: TTradingAccount, position: StockPosition | undefined) => void
  onClose: () => void
}

const HISTORY_PAGE_SIZE = 10
type OverflowDisposition = 'base' | 'opposite-t'

function localDateTimeInput(): string {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function emptyFees(): TTradeFees {
  return { commission: 0, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 }
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

export function TTradingDrawer({
  stock,
  quote,
  account,
  feeSettings,
  planDefaults,
  floatingProfitAlertDefaultThreshold,
  onApply,
  onClose
}: TTradingDrawerProps) {
  const confirm = useConfirmDialog()
  const currentAccount: TTradingAccount = account ?? {
    quoteId: stock.quoteId,
    code: stock.code,
    name: stock.name,
    history: [],
    ledger: { schemaVersion: 1, entries: [] },
    tradeRecords: []
  }
  const [side, setSide] = useState<TTradeSide>('buy')
  const [purpose, setPurpose] = useState<TTradePurpose>('t')
  const [price, setPrice] = useState(quote?.latest?.toString() ?? '')
  const [quantity, setQuantity] = useState('')
  const [tradedAt, setTradedAt] = useState(localDateTimeInput)
  const [note, setNote] = useState('')
  const [manualFees, setManualFees] = useState(false)
  const [feeOverrides, setFeeOverrides] = useState<TTradeFees>(emptyFees)
  const [overflowDisposition, setOverflowDisposition] = useState<OverflowDisposition>('base')
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [settlementBatchId, setSettlementBatchId] = useState('')
  const [latestPositionQuantity, setLatestPositionQuantity] = useState(
    stock.position?.quantity.toString() ?? '0'
  )
  const [latestPositionCost, setLatestPositionCost] = useState(
    stock.position?.cost.toString() ?? ''
  )
  const [settlementNote, setSettlementNote] = useState('')
  const [editingHistoryBatchId, setEditingHistoryBatchId] = useState<string | null>(null)
  const [historyProfitDraft, setHistoryProfitDraft] = useState('')
  const [historyProfitError, setHistoryProfitError] = useState('')
  const [showAllActiveTrades, setShowAllActiveTrades] = useState(false)
  const [showAllIndependentTrades, setShowAllIndependentTrades] = useState(false)
  const [historyPage, setHistoryPage] = useState(0)

  const market = stock.market ?? marketFromQuoteId(stock.quoteId)
  const currency = stock.currency ?? currencyForMarket(market)

  const activeTrades = getBatchTrades(currentAccount, currentAccount.activeBatch)
  const activeMetrics = useMemo(
    () => calculateTBatchMetrics(currentAccount.activeBatch, activeTrades, quote?.latest),
    [activeTrades, currentAccount.activeBatch, quote?.latest]
  )
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
    purpose === 'base'
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
  const tradeFees = manualFees ? feeOverrides : calculatedFees
  const readyToSettle = Boolean(
    currentAccount.activeBatch &&
    activeTrades.some((trade) => hasTAllocationForBatch(trade, currentAccount.activeBatch!.id)) &&
    activeMetrics.remainingQuantity === 0
  )

  useEffect(() => {
    const batchId = currentAccount.activeBatch?.id
    if (!readyToSettle || !batchId || settlementBatchId === batchId) return
    setSettlementBatchId(batchId)
    setLatestPositionQuantity(stock.position?.quantity.toString() ?? '0')
    setLatestPositionCost(stock.position?.cost.toString() ?? '')
  }, [
    currentAccount.activeBatch?.id,
    readyToSettle,
    settlementBatchId,
    stock.position?.cost,
    stock.position?.quantity
  ])

  const buyLevelRows = useMemo(
    () =>
      getTPlanRows(currentAccount.activeBatch, activeTrades, 'buy', feeSettings, stock.marketLabel),
    [activeTrades, currentAccount.activeBatch, feeSettings, stock.marketLabel]
  )
  const sellLevelRows = useMemo(
    () =>
      getTPlanRows(
        currentAccount.activeBatch,
        activeTrades,
        'sell',
        feeSettings,
        stock.marketLabel
      ),
    [activeTrades, currentAccount.activeBatch, feeSettings, stock.marketLabel]
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
  const visibleIndependentBaseTrades = showAllIndependentTrades
    ? independentBaseTradesDescending
    : independentBaseTradesDescending.slice(0, 5)

  const resetTradeForm = () => {
    setSide('buy')
    setPurpose('t')
    setPrice(quote?.latest?.toString() ?? '')
    setQuantity('')
    setTradedAt(localDateTimeInput())
    setNote('')
    setManualFees(false)
    setFeeOverrides(emptyFees())
    setOverflowDisposition('base')
    setEditingTradeId(null)
    setError('')
  }

  const applyAccount = (nextAccount: TTradingAccount, nextPosition: StockPosition | undefined) => {
    onApply(nextAccount, nextPosition)
  }

  const applyTradeAccount = (
    nextAccount: TTradingAccount,
    fallbackPosition: StockPosition | undefined
  ) => {
    const replay = calculatePortfolioLedgerPosition(nextAccount, market, currency)
    applyAccount(nextAccount, replay.error ? fallbackPosition : replay.position)
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

  const allocationForBatch = (
    allocationPurpose: TTradeAllocation['purpose'],
    allocationQuantity: number,
    batch: TTradingBatch
  ): TTradeAllocation => ({
    purpose: allocationPurpose,
    quantity: allocationQuantity,
    batchId: batch.id,
    batchSequence: batch.sequence,
    batchDirection: getTBatchDirection(batch)
  })

  const saveTrade = () => {
    if (numericPrice <= 0 || numericQuantity <= 0) {
      setError('请输入有效的成交价格和数量')
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
      market,
      currency,
      marketDate: tradedAt.slice(0, 10),
      exchangeRate: currency === 'CNY' ? 1 : editingTrade?.exchangeRate,
      exchangeRateDate: editingTrade?.exchangeRateDate,
      origin: editingTrade?.origin ?? 'execution',
      note: note.trim()
    }

    if (purpose === 'base') {
      const result = upsertIndependentBaseTrade(currentAccount, baseTrade, market, currency)
      if (result.error) {
        setError(`完整账本校验失败：${result.error}`)
        return
      }
      applyAccount(result.account, result.position)
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
      !editingTradeId
    )

    if (isOverflow && overflowDisposition === 'opposite-t') {
      if (batchTrades.some((item) => item.tradedAt > tradedAt)) {
        setError('开启反向T批次的成交时间不能早于当前批次已有流水')
        return
      }
      const nextDirection = getTBatchDirection(batch) === 'forward' ? 'reverse' : 'forward'
      const nextBatchDraft = createBatch(nextDirection, tradedAt, undefined)
      const trade: TTrade = {
        ...baseTrade,
        purpose: 't',
        allocations: [
          allocationForBatch('t', entryMetrics.remainingQuantity, batch),
          allocationForBatch('t', overflowQuantity, nextBatchDraft)
        ]
      }
      const closingTrades = [...batchTrades, trade].sort((left, right) =>
        left.tradedAt.localeCompare(right.tradedAt)
      )
      const closingValidationError = validateTBatchTrades(batch, closingTrades)
      if (closingValidationError) {
        setError(closingValidationError)
        return
      }

      const closingBatch = handleTriggeredTPlanAlertsForTrade(
        rebalanceTBatchPlans(batch, closingTrades, planDefaults),
        side
      )
      const closingMetrics = calculateTBatchMetrics(closingBatch, closingTrades, quote?.latest)
      if (closingMetrics.remainingQuantity !== 0) {
        setError('当前交易无法完整结束原T批次')
        return
      }
      const transitionPosition = recalculatePositionFromBatch(closingBatch, closingTrades)
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
      const nextBatchTrades = [trade]
      const nextValidationError = validateTBatchTrades(nextBatchBase, nextBatchTrades)
      if (nextValidationError) {
        setError(nextValidationError)
        return
      }
      const nextBatch = rebalanceTBatchPlans(nextBatchBase, nextBatchTrades, planDefaults)
      const nextRecords = upsertTradeRecord(currentAccount.tradeRecords, trade)
      applyTradeAccount(
        withLedgerTradeRecords(
          {
            ...currentAccount,
            activeBatch: nextBatch,
            history: [settledBatch, ...currentAccount.history]
          },
          nextRecords
        ),
        recalculatePositionFromBatch(nextBatch, nextBatchTrades)
      )
      setHistoryPage(0)
      resetTradeForm()
      return
    }

    const trade: TTrade = {
      ...baseTrade,
      allocations:
        hasFixedAllocations && editingTrade?.allocations
          ? editingTrade.allocations
          : isOverflow
            ? [
                allocationForBatch('t', entryMetrics.remainingQuantity, batch),
                { purpose: 'base', quantity: overflowQuantity }
              ]
            : [allocationForBatch(purpose, numericQuantity, batch)]
    }

    const nextTrades = [...batchTrades, trade].sort((left, right) =>
      left.tradedAt.localeCompare(right.tradedAt)
    )
    const validationError = validateTBatchTrades(batch, nextTrades)
    if (validationError) {
      setError(validationError)
      return
    }
    let plannedBatch = rebalanceTBatchPlans(batch, nextTrades, planDefaults)
    if (hasTAllocationForBatch(trade, batch.id)) {
      plannedBatch = handleTriggeredTPlanAlertsForTrade(plannedBatch, side)
    }
    const hasTTrades = nextTrades.some((item) => hasTAllocationForBatch(item, plannedBatch.id))
    const nextRecords = upsertTradeRecord(currentAccount.tradeRecords, trade)
    applyTradeAccount(
      withLedgerTradeRecords(
        {
          ...currentAccount,
          activeBatch: hasTTrades ? plannedBatch : undefined
        },
        hasTTrades ? nextRecords : detachTradeRecordsFromBatch(nextRecords, plannedBatch.id)
      ),
      recalculatePositionFromBatch(plannedBatch, nextTrades)
    )
    resetTradeForm()
  }

  const editTrade = (trade: TTrade) => {
    if (spansMultipleBatches(trade)) {
      setError('跨批次成交如需调整，请先删除该成交后重新录入')
      return
    }
    setEditingTradeId(trade.id)
    setSide(trade.side)
    setPurpose(trade.purpose)
    setPrice(trade.price.toString())
    setQuantity(trade.quantity.toString())
    setTradedAt(trade.tradedAt)
    setNote(trade.note)
    setManualFees(true)
    setFeeOverrides(trade.fees)
    setError('')
  }

  const deleteTrade = (tradeId: string) => {
    const record = currentAccount.tradeRecords.find((item) => item.id === tradeId)
    if (record && isIndependentBaseTrade(record)) {
      const result = deleteIndependentBaseTrade(currentAccount, tradeId, market, currency)
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
      const restoredBatch = rebalanceTBatchPlans(unsettledBatch, previousTrades, planDefaults)
      applyTradeAccount(
        withLedgerTradeRecords(
          {
            ...currentAccount,
            activeBatch: restoredBatch,
            history: currentAccount.history.filter((item) => item.id !== previousBatch.id)
          },
          nextRecords
        ),
        recalculatePositionFromBatch(restoredBatch, previousTrades)
      )
      resetTradeForm()
      return
    }
    const nextTrades = activeTrades.filter((trade) => trade.id !== tradeId)
    const validationError = validateTBatchTrades(batch, nextTrades)
    if (validationError) {
      setError(validationError)
      return
    }
    const plannedBatch = rebalanceTBatchPlans(batch, nextTrades, planDefaults)
    const hasTTrades = nextTrades.some((trade) => hasTAllocationForBatch(trade, plannedBatch.id))
    const nextRecords = currentAccount.tradeRecords.filter((record) => record.id !== tradeId)
    applyTradeAccount(
      withLedgerTradeRecords(
        {
          ...currentAccount,
          activeBatch: hasTTrades ? plannedBatch : undefined
        },
        hasTTrades ? nextRecords : detachTradeRecordsFromBatch(nextRecords, plannedBatch.id)
      ),
      recalculatePositionFromBatch(plannedBatch, nextTrades)
    )
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
    const nextBatch = updateTPlanLevel(batch, side, index, key, value)
    applyAccount(
      {
        ...currentAccount,
        activeBatch: nextBatch.alertEnabled
          ? applyTAlertTriggers(nextBatch, activeTrades, quote?.latest).batch
          : nextBatch
      },
      stock.position
    )
  }

  const resetPlanLevels = () => {
    const batch = currentAccount.activeBatch
    if (!batch) return
    const nextBatch = resetTBatchPlans(batch, activeTrades, planDefaults)
    applyAccount(
      {
        ...currentAccount,
        activeBatch: nextBatch.alertEnabled
          ? applyTAlertTriggers(nextBatch, activeTrades, quote?.latest).batch
          : nextBatch
      },
      stock.position
    )
  }

  const togglePriceAlerts = () => {
    const batch = currentAccount.activeBatch
    if (!batch) return
    const nextBatch = setTAlertEnabled(batch, !batch.alertEnabled)
    applyAccount(
      {
        ...currentAccount,
        activeBatch: nextBatch.alertEnabled
          ? applyTAlertTriggers(nextBatch, activeTrades, quote?.latest).batch
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
          ? applyTAlertTriggers(nextBatch, activeTrades, quote?.latest).batch
          : nextBatch
      },
      stock.position
    )
  }

  const settleBatch = () => {
    const batch = currentAccount.activeBatch
    if (!batch || activeMetrics.remainingQuantity !== 0) return

    const finalQuantity = Math.max(0, Number(latestPositionQuantity) || 0)
    const hasLatestCost = latestPositionCost.trim() !== ''
    const finalCost = hasLatestCost ? Number(latestPositionCost) : undefined
    const settlementPositionError = validateTBatchSettlementPosition(finalQuantity, finalCost)
    if (settlementPositionError) {
      setError(settlementPositionError)
      return
    }

    const costAdjustedProfit =
      finalCost === undefined
        ? undefined
        : calculateCostAdjustedProfit(batch, activeTrades, finalQuantity, finalCost)
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
    const settledBatch = { ...batch, settlement }
    const nextPosition =
      finalQuantity > 0 && finalCost !== undefined
        ? {
            quantity: finalQuantity,
            cost: finalCost,
            openedToday: false,
            openedOn: stock.position?.openedOn ?? batch.openingPosition?.openedOn
          }
        : undefined

    applyAccount(
      {
        ...currentAccount,
        activeBatch: undefined,
        history: [settledBatch, ...currentAccount.history]
      },
      nextPosition
    )
    setHistoryPage(0)
    setSettlementNote('')
    setSettlementBatchId('')
    resetTradeForm()
  }

  const startEditingHistoryProfit = (batch: TTradingBatch) => {
    if (!batch.settlement) return
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

    applyAccount(
      withLedgerTradeRecords(
        {
          ...currentAccount,
          history: currentAccount.history.filter((item) => item.id !== batch.id)
        },
        currentAccount.tradeRecords.filter((record) => !tradeReferencesBatch(record, batch.id))
      ),
      stock.position
    )

    if (editingHistoryBatchId === batch.id) cancelEditingHistoryProfit()
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
              <strong>{formatShares(stock.position?.quantity)}</strong>
            </span>
            <span>
              <small>{isReverseBatch ? '待回补数量' : '当前T仓'}</small>
              <strong>{formatShares(activeMetrics.remainingQuantity)}</strong>
            </span>
            <span>
              <small>{isReverseBatch ? '反T基准价' : 'T仓成本'}</small>
              <strong>{formatCost(activeMetrics.averageCost)}</strong>
            </span>
            <span>
              <small>当前价格</small>
              <strong>{formatPrice(quote?.latest)}</strong>
            </span>
            <span>
              <small>做T总收益</small>
              <strong className={valueClass(totalHistoryProfit)}>
                {formatProfit(totalHistoryProfit)}
              </strong>
            </span>
            <span className="t-overview-fee">
              <small>做T总费用</small>
              <strong>{formatCurrency(totalHistoryFees)}</strong>
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
                  className={side === 'buy' ? 'is-active' : ''}
                  type="button"
                  disabled={hasFixedAllocations}
                  onClick={() => {
                    setSide('buy')
                    setPurpose('t')
                  }}
                >
                  买入
                </button>
                <button
                  className={side === 'sell' ? 'is-active' : ''}
                  type="button"
                  disabled={hasFixedAllocations}
                  onClick={() => {
                    setSide('sell')
                    setPurpose('t')
                  }}
                >
                  卖出
                </button>
                <button
                  className={purpose === 't' ? 'is-purpose-active' : ''}
                  type="button"
                  disabled={hasFixedAllocations}
                  onClick={() => setPurpose('t')}
                >
                  {tPurposeLabel}
                </button>
                <button
                  className={purpose === 'base' ? 'is-purpose-active' : ''}
                  type="button"
                  disabled={hasFixedAllocations}
                  onClick={() => setPurpose('base')}
                >
                  {basePurposeLabel}
                </button>
              </div>

              <div className="t-fee-summary">
                <span>佣金 {formatCurrency(tradeFees.commission)}</span>
                <span>经手 {formatCurrency(tradeFees.handling)}</span>
                <span>证管 {formatCurrency(tradeFees.regulatory)}</span>
                <span>过户 {formatCurrency(tradeFees.transfer)}</span>
                <span>印花税 {formatCurrency(tradeFees.stampDuty)}</span>
                <strong>合计 {formatCurrency(totalTradeFees(tradeFees))}</strong>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    if (!manualFees) setFeeOverrides(calculatedFees)
                    setManualFees((current) => !current)
                  }}
                >
                  {manualFees ? '恢复自动计算' : '手动修改费用'}
                </button>
              </div>
            </div>

            <div className="t-entry-input-row">
              <div className="t-form-grid">
                <label>
                  <span>成交价格</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                  />
                </label>
                <label>
                  <span>成交数量</span>
                  <input
                    type="number"
                    min="100"
                    step="100"
                    value={quantity}
                    disabled={hasFixedAllocations}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </label>
                <label>
                  <span>成交时间</span>
                  <input
                    type="datetime-local"
                    value={tradedAt}
                    onChange={(event) => setTradedAt(event.target.value)}
                  />
                </label>
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
                <span>成交额 {formatCurrency(numericPrice * numericQuantity)}</span>
                <button className="primary-button compact-button" type="button" onClick={saveTrade}>
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
                <small>手续费按 {formatShares(numericQuantity)} 整笔计算一次，再按数量分摊</small>
              </div>
            ) : null}

            {manualFees ? (
              <div className="t-fee-inputs">
                {feeInput('commission', '佣金')}
                {feeInput('handling', '经手费')}
                {feeInput('regulatory', '证管费')}
                {feeInput('transfer', '过户费')}
                {feeInput('stampDuty', '印花税')}
              </div>
            ) : null}

            {error ? <div className="t-form-error">{error}</div> : null}
          </section>

          {independentBaseTradesDescending.length > 0 ? (
            <section className="t-card t-base-ledger-card">
              <div className="t-card-heading">
                <span>
                  <strong>底仓流水</strong>
                  <small>账户级交易，不归属任何 T 批次，用于完整账本持仓重算</small>
                </span>
                <div className="t-batch-summary">
                  <em>{independentBaseTradesDescending.length} 笔流水</em>
                </div>
              </div>
              <div className="t-trade-list">
                {visibleIndependentBaseTrades.map((trade) => {
                  const fees = totalTradeFees(trade.fees)
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
                          {formatTradeTime(trade.tradedAt)} · 费用 {formatCurrency(fees)}
                        </small>
                      </span>
                      <span className="t-trade-amount">
                        <span>{formatCurrency(trade.price * trade.quantity)}</span>
                        <small>{trade.note || '独立底仓流水'}</small>
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
                {independentBaseTradesDescending.length > 5 ? (
                  <button
                    className="t-trade-more-button"
                    type="button"
                    onClick={() => setShowAllIndependentTrades((current) => !current)}
                  >
                    {showAllIndependentTrades
                      ? '收起底仓流水'
                      : `显示更多底仓流水（其余 ${independentBaseTradesDescending.length - 5} 条）`}
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}

          {currentAccount.activeBatch ? (
            <>
              <section
                className={`t-card t-active-batch-card ${
                  independentBaseTradesDescending.length === 0 ? 'is-full-width' : ''
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
                        {formatProfit(activeMetrics.floatingProfit)}
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
                        {formatProfit(activeMetrics.realizedProfit)}
                      </strong>
                    </span>
                    <span>
                      <small>当前批次费用</small>
                      <strong>{formatCurrency(currentBatchFees)}</strong>
                    </span>
                    <em>{activeTrades.length} 笔流水</em>
                  </div>
                </div>
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
                        <em>元</em>
                      </label>
                      <TFloatingProfitAlertBadge
                        batch={currentAccount.activeBatch}
                        floatingProfit={activeMetrics.floatingProfit}
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
                            {formatCurrency(allocation.fees)}
                            {summary ? ` · ${summary}` : ''}
                          </small>
                        </span>
                        <span className="t-trade-amount">
                          <span>{formatCurrency(trade.price * allocation.quantity)}</span>
                          <small>
                            {trade.side === 'buy' ? '含费成本' : '净到账'}{' '}
                            {formatCurrency(
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
                  <div className="t-plan-scroll">
                    <div className="t-plan-grid">
                      <TPlanTable
                        side="buy"
                        rows={buyLevelRows}
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
                        {formatProfit(activeMetrics.realizedProfit)}
                      </strong>
                    </span>
                    <span>
                      <small>买入总额</small>
                      <strong>{formatCurrency(activeMetrics.buyAmount)}</strong>
                    </span>
                    <span>
                      <small>卖出总额</small>
                      <strong>{formatCurrency(activeMetrics.sellAmount)}</strong>
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
                  {latestPositionCost.trim() !== '' ? (
                    <div className="t-cost-profit-preview">
                      按最新成本推算：
                      <strong
                        className={valueClass(
                          calculateCostAdjustedProfit(
                            currentAccount.activeBatch,
                            activeTrades,
                            Math.max(0, Number(latestPositionQuantity) || 0),
                            Number(latestPositionCost) || 0
                          )
                        )}
                      >
                        {formatProfit(
                          calculateCostAdjustedProfit(
                            currentAccount.activeBatch,
                            activeTrades,
                            Math.max(0, Number(latestPositionQuantity) || 0),
                            Number(latestPositionCost) || 0
                          )
                        )}
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
          ) : (
            <section
              className={`t-empty-batch ${
                independentBaseTradesDescending.length === 0 ? 'is-full-width' : ''
              }`}
            >
              <Repeat2 size={24} />
              <strong>当前没有进行中的T批次</strong>
              <span>首笔计入T仓的买入开启正T，卖出开启反T</span>
            </section>
          )}

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
                            {formatProfit(batch.settlement?.finalProfit)}
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
                              <span>{formatTradeTime(trade.tradedAt)}</span>
                              <span>
                                {formatShares(allocation.quantity)} × {formatPrice(trade.price)}
                                {summary ? ` · ${summary}` : ''}
                              </span>
                              <span>分摊费用 {formatCurrency(totalFees)}</span>
                              <strong className={valueClass(amountChange)}>
                                金额变动 {formatProfit(amountChange)}
                              </strong>
                            </span>
                          )
                        })}
                        {batch.settlement ? (
                          <div className="t-history-settlement">
                            <p>
                              流水收益{' '}
                              <strong className={valueClass(batch.settlement.ledgerProfit)}>
                                {formatProfit(batch.settlement.ledgerProfit)}
                              </strong>
                              {batch.settlement.costAdjustedProfit !== undefined ? (
                                <>
                                  {' · 成本校准 '}
                                  <strong
                                    className={valueClass(batch.settlement.costAdjustedProfit)}
                                  >
                                    {formatProfit(batch.settlement.costAdjustedProfit)}
                                  </strong>
                                </>
                              ) : null}
                              {batch.settlement.note ? ` · ${batch.settlement.note}` : ''}
                            </p>
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
