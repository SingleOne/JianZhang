import {
  CheckCircle2,
  PencilLine,
  Plus,
  RefreshCcw,
  Repeat2,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatCost, formatCurrency, formatPrice, formatProfit, formatShares } from '../lib/format'
import {
  applyTradeToPosition,
  calculateCostAdjustedProfit,
  calculateTBatchMetrics,
  calculateTradeFees,
  createDefaultSellLevels,
  recalculatePositionFromBatch,
  roundMoney,
  totalTradeFees
} from '../lib/t-trading'
import type {
  StockPosition,
  StockQuote,
  TTradingAccount,
  TTradingBatch,
  TTradingFeeSettings,
  TTrade,
  TTradeFees,
  TTradePurpose,
  TTradeSide,
  WatchStock
} from '../shared/types'

interface TTradingDrawerProps {
  stock: WatchStock
  quote: StockQuote | undefined
  account: TTradingAccount | undefined
  feeSettings: TTradingFeeSettings
  onApply: (account: TTradingAccount, position: StockPosition | undefined) => void
  onClose: () => void
}

function localDateTimeInput(): string {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
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

export function TTradingDrawer({
  stock,
  quote,
  account,
  feeSettings,
  onApply,
  onClose
}: TTradingDrawerProps) {
  const currentAccount: TTradingAccount = account ?? {
    quoteId: stock.quoteId,
    code: stock.code,
    name: stock.name,
    history: []
  }
  const [side, setSide] = useState<TTradeSide>('buy')
  const [purpose, setPurpose] = useState<TTradePurpose>('t')
  const [price, setPrice] = useState(quote?.latest?.toString() ?? '')
  const [quantity, setQuantity] = useState('')
  const [tradedAt, setTradedAt] = useState(localDateTimeInput)
  const [note, setNote] = useState('')
  const [manualFees, setManualFees] = useState(false)
  const [feeOverrides, setFeeOverrides] = useState<TTradeFees>(emptyFees)
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

  const activeMetrics = useMemo(
    () => calculateTBatchMetrics(currentAccount.activeBatch, quote?.latest),
    [currentAccount.activeBatch, quote?.latest]
  )
  const numericPrice = Number(price)
  const numericQuantity = Number(quantity)
  const calculatedFees = useMemo(
    () => calculateTradeFees(
      Math.max(0, numericPrice * numericQuantity),
      side,
      feeSettings,
      stock.marketLabel
    ),
    [feeSettings, numericPrice, numericQuantity, side, stock.marketLabel]
  )
  const tradeFees = manualFees ? feeOverrides : calculatedFees
  const readyToSettle = Boolean(
    currentAccount.activeBatch
    && currentAccount.activeBatch.trades.some((trade) => trade.purpose === 't')
    && activeMetrics.remainingQuantity === 0
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

  const sellLevelRows = useMemo(() => {
    const averageCost = activeMetrics.averageCost
    let cumulativeProfit = activeMetrics.realizedProfit
    return (currentAccount.activeBatch?.sellLevels ?? []).map((level, index) => {
      const targetPrice = averageCost === null
        ? null
        : averageCost * (1 + level.targetPercent / 100)
      const hasSellQuantity = level.quantity >= 100
      const fees = targetPrice === null || !hasSellQuantity
        ? emptyFees()
        : calculateTradeFees(targetPrice * level.quantity, 'sell', feeSettings, stock.marketLabel)
      const expectedProfit = targetPrice === null || averageCost === null || !hasSellQuantity
        ? null
        : (targetPrice - averageCost) * level.quantity - totalTradeFees(fees)
      const fullPositionFees = targetPrice === null
        ? emptyFees()
        : calculateTradeFees(
          targetPrice * activeMetrics.remainingQuantity,
          'sell',
          feeSettings,
          stock.marketLabel
        )
      const fullPositionProfit = targetPrice === null || averageCost === null
        ? null
        : activeMetrics.realizedProfit
          + (targetPrice - averageCost) * activeMetrics.remainingQuantity
          - totalTradeFees(fullPositionFees)
      if (expectedProfit !== null) cumulativeProfit += expectedProfit
      return {
        ...level,
        index,
        targetPrice,
        fees,
        expectedProfit,
        cumulativeProfit,
        fullPositionProfit
      }
    })
  }, [
    activeMetrics.averageCost,
    activeMetrics.realizedProfit,
    activeMetrics.remainingQuantity,
    currentAccount.activeBatch?.sellLevels,
    feeSettings,
    stock.marketLabel
  ])
  const activeTradesDescending = useMemo(
    () => (currentAccount.activeBatch?.trades ?? [])
      .map((trade, index) => ({ trade, index }))
      .sort((left, right) => (
        right.trade.tradedAt.localeCompare(left.trade.tradedAt)
        || right.index - left.index
      ))
      .map(({ trade }) => trade),
    [currentAccount.activeBatch?.trades]
  )
  const visibleActiveTrades = showAllActiveTrades
    ? activeTradesDescending
    : activeTradesDescending.slice(0, 5)

  const resetTradeForm = () => {
    setSide('buy')
    setPurpose('t')
    setPrice(quote?.latest?.toString() ?? '')
    setQuantity('')
    setTradedAt(localDateTimeInput())
    setNote('')
    setManualFees(false)
    setFeeOverrides(emptyFees())
    setEditingTradeId(null)
    setError('')
  }

  const applyAccount = (
    nextAccount: TTradingAccount,
    nextPosition: StockPosition | undefined
  ) => {
    onApply(nextAccount, nextPosition)
  }

  const saveTrade = () => {
    if (numericPrice <= 0 || numericQuantity <= 0) {
      setError('请输入有效的成交价格和数量')
      return
    }

    const resolvedPurpose = side === 'sell' ? 't' : purpose
    const trade: TTrade = {
      id: editingTradeId ?? crypto.randomUUID(),
      side,
      purpose: resolvedPurpose,
      tradedAt,
      price: numericPrice,
      quantity: numericQuantity,
      fees: tradeFees,
      note: note.trim()
    }

    if (resolvedPurpose === 'base' && !currentAccount.activeBatch) {
      applyAccount(currentAccount, applyTradeToPosition(stock.position, trade))
      resetTradeForm()
      return
    }

    let batch: TTradingBatch
    if (currentAccount.activeBatch) {
      batch = {
        ...currentAccount.activeBatch,
        trades: currentAccount.activeBatch.trades.filter((item) => item.id !== editingTradeId)
      }
    } else {
      batch = {
        id: crypto.randomUUID(),
        sequence: Math.max(0, ...currentAccount.history.map((item) => item.sequence)) + 1,
        openedAt: tradedAt,
        openingPosition: positionSnapshot(stock.position),
        trades: [],
        sellLevels: []
      }
    }

    const beforeMetrics = calculateTBatchMetrics(batch)
    if (side === 'sell' && numericQuantity > beforeMetrics.remainingQuantity) {
      setError(`卖出数量不能超过当前T仓 ${beforeMetrics.remainingQuantity} 股`)
      return
    }
    if (
      !editingTradeId
      && activeMetrics.remainingQuantity === 0
      && batch.trades.some((item) => item.purpose === 't')
    ) {
      setError('当前批次已清空，请先完成结算')
      return
    }

    const nextTrades = [...batch.trades, trade]
      .sort((left, right) => left.tradedAt.localeCompare(right.tradedAt))
    let runningTQuantity = 0
    for (const item of nextTrades) {
      if (item.purpose !== 't') continue
      runningTQuantity += item.side === 'buy' ? item.quantity : -item.quantity
      if (runningTQuantity < 0) {
        setError('交易顺序或数量会导致T仓卖超，请检查买卖流水')
        return
      }
    }
    const nextBatch = { ...batch, trades: nextTrades }
    const nextMetrics = calculateTBatchMetrics(nextBatch)
    nextBatch.sellLevels = createDefaultSellLevels(nextMetrics.remainingQuantity)
    const hasTTrades = nextBatch.trades.some((trade) => trade.purpose === 't')
    applyAccount(
      { ...currentAccount, activeBatch: hasTTrades ? nextBatch : undefined },
      recalculatePositionFromBatch(nextBatch)
    )
    resetTradeForm()
  }

  const editTrade = (trade: TTrade) => {
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
    const batch = currentAccount.activeBatch
    if (!batch) return
    const nextBatch = {
      ...batch,
      trades: batch.trades.filter((trade) => trade.id !== tradeId)
    }
    const nextMetrics = calculateTBatchMetrics(nextBatch)
    nextBatch.sellLevels = createDefaultSellLevels(nextMetrics.remainingQuantity)
    const hasTTrades = nextBatch.trades.some((trade) => trade.purpose === 't')
    applyAccount(
      { ...currentAccount, activeBatch: hasTTrades ? nextBatch : undefined },
      recalculatePositionFromBatch(nextBatch)
    )
    if (editingTradeId === tradeId) resetTradeForm()
  }

  const updateSellLevel = (
    index: number,
    key: 'targetPercent' | 'quantity',
    value: number
  ) => {
    const batch = currentAccount.activeBatch
    if (!batch) return
    const sellLevels = batch.sellLevels.map((level, levelIndex) => (
      levelIndex === index ? { ...level, [key]: Math.max(0, value || 0) } : level
    ))
    applyAccount({ ...currentAccount, activeBatch: { ...batch, sellLevels } }, stock.position)
  }

  const resetSellLevels = () => {
    const batch = currentAccount.activeBatch
    if (!batch) return
    applyAccount({
      ...currentAccount,
      activeBatch: {
        ...batch,
        sellLevels: createDefaultSellLevels(activeMetrics.remainingQuantity)
      }
    }, stock.position)
  }

  const settleBatch = () => {
    const batch = currentAccount.activeBatch
    if (!batch || activeMetrics.remainingQuantity !== 0) return

    const finalQuantity = Math.max(0, Number(latestPositionQuantity) || 0)
    const hasLatestCost = latestPositionCost.trim() !== ''
    const finalCost = hasLatestCost ? Number(latestPositionCost) : undefined
    if (finalQuantity > 0 && (!finalCost || finalCost <= 0)) {
      setError('仍有持仓时，请填写券商最新持仓成本')
      return
    }

    const costAdjustedProfit = finalCost === undefined
      ? undefined
      : calculateCostAdjustedProfit(batch, finalQuantity, finalCost)
    const settlement = {
      settledAt: new Date().toISOString(),
      latestPositionQuantity: finalQuantity,
      latestPositionCost: finalCost,
      ledgerProfit: activeMetrics.realizedProfit,
      costAdjustedProfit,
      finalProfit: costAdjustedProfit ?? activeMetrics.realizedProfit,
      source: costAdjustedProfit === undefined ? 'ledger' as const : 'position-cost' as const,
      note: settlementNote.trim()
    }
    const settledBatch = { ...batch, settlement }
    const nextPosition = finalQuantity > 0 && finalCost !== undefined
      ? {
          quantity: finalQuantity,
          cost: finalCost,
          openedToday: false,
          openedOn: stock.position?.openedOn ?? batch.openingPosition?.openedOn
        }
      : undefined

    applyAccount({
      ...currentAccount,
      activeBatch: undefined,
      history: [settledBatch, ...currentAccount.history]
    }, nextPosition)
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

  const deleteHistoryBatch = (batch: TTradingBatch) => {
    const confirmed = window.confirm(
      `确定删除做T历史批次 #${batch.sequence} 吗？删除后无法恢复。`
    )
    if (!confirmed) return

    applyAccount({
      ...currentAccount,
      history: currentAccount.history.filter((item) => item.id !== batch.id)
    }, stock.position)

    if (editingHistoryBatchId === batch.id) cancelEditingHistoryProfit()
  }

  const feeInput = (
    key: keyof TTradeFees,
    label: string
  ) => (
    <label>
      <span>{label}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={feeOverrides[key]}
        onChange={(event) => setFeeOverrides((current) => ({
          ...current,
          [key]: Math.max(0, Number(event.target.value) || 0)
        }))}
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
            <span className="t-trading-icon"><Repeat2 size={20} /></span>
            <span>
              <strong id="t-trading-title">T仓管理 · {stock.name}</strong>
              <small>{stock.code} · 记录T仓买卖、目标价格与批次收益</small>
            </span>
          </div>
          <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="关闭">
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
              <small>当前T仓</small>
              <strong>{formatShares(activeMetrics.remainingQuantity)}</strong>
            </span>
            <span>
              <small>T仓成本</small>
              <strong>{formatCost(activeMetrics.averageCost)}</strong>
            </span>
            <span>
              <small>已实现收益</small>
              <strong className={valueClass(activeMetrics.realizedProfit)}>
                {formatProfit(activeMetrics.realizedProfit)}
              </strong>
            </span>
            <span>
              <small>浮动收益</small>
              <strong className={valueClass(activeMetrics.floatingProfit)}>
                {formatProfit(activeMetrics.floatingProfit)}
              </strong>
            </span>
            <span>
              <small>当前价格</small>
              <strong>{formatPrice(quote?.latest)}</strong>
            </span>
          </section>

          <section className="t-card t-trade-entry">
            <div className="t-card-heading">
              <span>
                <strong>{editingTradeId ? '修改交易' : '快速录入交易'}</strong>
                <small>买入时选择T仓或增加底仓，卖出只冲减当前T仓</small>
              </span>
              {editingTradeId ? (
                <button type="button" className="text-button" onClick={resetTradeForm}>取消修改</button>
              ) : null}
            </div>

            <div className="t-segmented">
              <button
                className={side === 'buy' ? 'is-active' : ''}
                type="button"
                onClick={() => { setSide('buy'); setPurpose('t') }}
              >
                买入
              </button>
              <button
                className={side === 'sell' ? 'is-active' : ''}
                type="button"
                onClick={() => { setSide('sell'); setPurpose('t') }}
              >
                卖出T仓
              </button>
              {side === 'buy' ? (
                <>
                  <button
                    className={purpose === 't' ? 'is-purpose-active' : ''}
                    type="button"
                    onClick={() => setPurpose('t')}
                  >
                    计入T仓
                  </button>
                  <button
                    className={purpose === 'base' ? 'is-purpose-active' : ''}
                    type="button"
                    onClick={() => setPurpose('base')}
                  >
                    增加底仓
                  </button>
                </>
              ) : null}
            </div>

            <div className="t-form-grid">
              <label>
                <span>成交价格</span>
                <input type="number" min="0.01" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} />
              </label>
              <label>
                <span>成交数量</span>
                <input type="number" min="100" step="100" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
              </label>
              <label>
                <span>成交时间</span>
                <input type="datetime-local" value={tradedAt} onChange={(event) => setTradedAt(event.target.value)} />
              </label>
              <label>
                <span>备注</span>
                <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选" />
              </label>
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
            <div className="t-entry-actions">
              <span>成交额 {formatCurrency(numericPrice * numericQuantity)}</span>
              <button className="primary-button compact-button" type="button" onClick={saveTrade}>
                <Plus size={15} />
                {editingTradeId ? '保存修改' : '记录交易'}
              </button>
            </div>
          </section>

          {currentAccount.activeBatch ? (
            <>
              <section className="t-card">
                <div className="t-card-heading">
                  <span>
                    <strong>当前批次 #{currentAccount.activeBatch.sequence}</strong>
                    <small>开始于 {formatTradeTime(currentAccount.activeBatch.openedAt)}</small>
                  </span>
                  <em>{currentAccount.activeBatch.trades.length} 笔流水</em>
                </div>
                <div className="t-trade-list">
                  {visibleActiveTrades.map((trade) => (
                    <div className="t-trade-row" key={trade.id}>
                      <span className={`t-trade-side is-${trade.side}`}>
                        {trade.purpose === 'base' ? '底仓' : trade.side === 'buy' ? 'T买' : 'T卖'}
                      </span>
                      <span>
                        <strong>{formatShares(trade.quantity)} × {formatPrice(trade.price)}</strong>
                        <small>{formatTradeTime(trade.tradedAt)} · 费用 {formatCurrency(totalTradeFees(trade.fees))}</small>
                      </span>
                      <span className="t-trade-amount">
                        <span>{formatCurrency(trade.price * trade.quantity)}</span>
                        <small>
                          {trade.side === 'buy' ? '含费成本' : '净到账'}
                          {' '}
                          {formatCurrency(
                            trade.price * trade.quantity
                            + (trade.side === 'buy' ? 1 : -1) * totalTradeFees(trade.fees)
                          )}
                        </small>
                      </span>
                      <span className="t-trade-actions">
                        <button className="icon-button" type="button" onClick={() => editTrade(trade)} title="修改交易">
                          <PencilLine size={14} />
                        </button>
                        <button className="icon-button" type="button" onClick={() => deleteTrade(trade.id)} title="删除交易">
                          <Trash2 size={14} />
                        </button>
                      </span>
                    </div>
                  ))}
                  {activeTradesDescending.length > 5 ? (
                    <button
                      className="t-trade-more-button"
                      type="button"
                      onClick={() => setShowAllActiveTrades((current) => !current)}
                    >
                      {showAllActiveTrades
                        ? '收起交易记录'
                        : `显示更多（其余 ${activeTradesDescending.length - 5} 条）`}
                    </button>
                  ) : null}
                </div>
              </section>

              {activeMetrics.remainingQuantity > 0 ? (
                <section className="t-card">
                  <div className="t-card-heading">
                    <span>
                      <strong>五档卖出计划</strong>
                      <small>默认 +1% 至 +5%，预期收益已扣除预计卖出费用</small>
                    </span>
                    <button type="button" className="text-button" onClick={resetSellLevels}>
                      <RefreshCcw size={13} /> 重新均分
                    </button>
                  </div>
                  <div className="t-sell-levels">
                    <div className="t-sell-level t-sell-level-head">
                      <span>档位</span>
                      <span>目标涨幅</span>
                      <span>目标价格</span>
                      <span>卖出数量</span>
                      <span>本档净收益</span>
                      <span>全仓卖出收益</span>
                      <span>累计收益</span>
                    </div>
                    {sellLevelRows.map((level) => (
                      <div className="t-sell-level" key={level.index}>
                        <strong>{level.index + 1}</strong>
                        <label>
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={level.targetPercent}
                            onChange={(event) => updateSellLevel(level.index, 'targetPercent', Number(event.target.value))}
                          />
                          <span>%</span>
                        </label>
                        <span>{level.targetPrice === null ? '--' : level.targetPrice.toFixed(2)}</span>
                        <label>
                          <input
                            type="number"
                            min="100"
                            step="100"
                            value={level.quantity || ''}
                            onChange={(event) => updateSellLevel(level.index, 'quantity', Number(event.target.value))}
                          />
                          <span>股</span>
                        </label>
                        <span className={valueClass(level.expectedProfit)}>{formatProfit(level.expectedProfit)}</span>
                        <span className={valueClass(level.fullPositionProfit)}>{formatProfit(level.fullPositionProfit)}</span>
                        <span className={valueClass(level.cumulativeProfit)}>{formatProfit(level.cumulativeProfit)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {readyToSettle ? (
                <section className="t-card t-settlement-card">
                  <div className="t-card-heading">
                    <span>
                      <strong>本批次T仓已清空</strong>
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
                        min="0.0001"
                        step="0.0001"
                        value={latestPositionCost}
                        onChange={(event) => setLatestPositionCost(event.target.value)}
                        placeholder="留空则采用流水收益"
                      />
                    </label>
                    <label className="is-wide">
                      <span>结算备注</span>
                      <input value={settlementNote} onChange={(event) => setSettlementNote(event.target.value)} />
                    </label>
                  </div>
                  {latestPositionCost.trim() !== '' ? (
                    <div className="t-cost-profit-preview">
                      按最新成本推算：
                      <strong className={valueClass(calculateCostAdjustedProfit(
                        currentAccount.activeBatch,
                        Math.max(0, Number(latestPositionQuantity) || 0),
                        Number(latestPositionCost) || 0
                      ))}>
                        {formatProfit(calculateCostAdjustedProfit(
                          currentAccount.activeBatch,
                          Math.max(0, Number(latestPositionQuantity) || 0),
                          Number(latestPositionCost) || 0
                        ))}
                      </strong>
                    </div>
                  ) : null}
                  <div className="t-entry-actions">
                    <span>结算后，下一笔T仓买入将创建新批次</span>
                    <button className="primary-button compact-button" type="button" onClick={settleBatch}>
                      确认结算并归档
                    </button>
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <section className="t-empty-batch">
              <Repeat2 size={24} />
              <strong>当前没有进行中的T批次</strong>
              <span>录入第一笔“计入T仓”的买入后自动创建新批次</span>
            </section>
          )}

          {currentAccount.history.length > 0 ? (
            <section className="t-card">
              <div className="t-card-heading">
                <span>
                  <strong>做T历史</strong>
                  <small>共完成 {currentAccount.history.length} 个批次</small>
                </span>
              </div>
              <div className="t-history-list">
                {currentAccount.history.map((batch) => (
                  <details key={batch.id}>
                    <summary>
                      <span>
                        <strong>批次 #{batch.sequence}</strong>
                        <small>{formatTradeTime(batch.openedAt)} 至 {batch.settlement ? formatTradeTime(batch.settlement.settledAt) : '--'}</small>
                      </span>
                      <span>
                        <small>{batch.settlement?.source === 'position-cost' ? '成本校准收益' : '流水收益'}</small>
                        <strong className={`t-history-profit ${valueClass(batch.settlement?.finalProfit)}`}>
                          {formatProfit(batch.settlement?.finalProfit)}
                        </strong>
                      </span>
                    </summary>
                    <div>
                      {batch.trades.map((trade) => (
                        <span key={trade.id}>
                          <b>{trade.purpose === 'base' ? '底仓买入' : trade.side === 'buy' ? 'T仓买入' : 'T仓卖出'}</b>
                          {formatTradeTime(trade.tradedAt)}
                          {formatShares(trade.quantity)} × {formatPrice(trade.price)}
                          费用 {formatCurrency(totalTradeFees(trade.fees))}
                        </span>
                      ))}
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
                                <strong className={valueClass(batch.settlement.costAdjustedProfit)}>
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
                              <button className="text-button" type="button" onClick={cancelEditingHistoryProfit}>
                                取消
                              </button>
                              {historyProfitError ? <small>{historyProfitError}</small> : null}
                            </div>
                          ) : (
                            <button
                              className="text-button t-history-edit-button"
                              type="button"
                              onClick={() => startEditingHistoryProfit(batch)}
                            >
                              <PencilLine size={12} />
                              修改成本校准收益
                            </button>
                          )}
                          <button
                            className="text-button t-history-delete-button"
                            type="button"
                            onClick={() => deleteHistoryBatch(batch)}
                          >
                            <Trash2 size={12} />
                            删除此批次
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </aside>
    </div>,
    document.body
  )
}
