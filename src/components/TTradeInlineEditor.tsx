import { useState } from 'react'
import { upsertIndependentBaseTrade } from '../lib/base-trades'
import {
  estimateSettlementDate,
  marketTradeQuantityError,
  settlementRuleForTradeDate
} from '../lib/market-trades'
import {
  activePortfolioLedgerEntries,
  calculatePortfolioLedgerPosition
} from '../lib/portfolio-ledger'
import { reconcileStockTBatches } from '../lib/stock-t-trading'
import { createTPlanLevelsFromDefaults, roundMoney, totalRecordedTradeFees } from '../lib/t-trading'
import {
  getTradeAllocations,
  isIndependentBaseTrade,
  toTradeRecord,
  upsertTradeRecord
} from '../lib/trade-records'
import { currencyForMarket, marketFromQuoteId } from '../shared/stock-market'
import { getStockTBatches } from '../shared/stock-t-batches'
import { withLedgerTradeRecords } from '../shared/types'
import type {
  StockTradingBook,
  TPlanDefaultSettings,
  TTradingBatch,
  TTrade,
  TTradePurpose,
  TTradeRecord,
  TTradeSide,
  TradingCalendarSettings
} from '../shared/types'
import { AppButton } from './AppButton'
import { AppInput } from './AppFormControls'
import { AppSelect } from './AppSelect'

interface Props {
  book: StockTradingBook
  trade: TTrade
  planDefaults: TPlanDefaultSettings
  tradingCalendar: TradingCalendarSettings
  floatingProfitAlertDefaultThreshold: number
  onApply: (book: StockTradingBook) => void
  onComplete: () => void
}

export function TTradeInlineEditor({
  book,
  trade,
  planDefaults,
  tradingCalendar,
  floatingProfitAlertDefaultThreshold,
  onApply,
  onComplete
}: Props) {
  const market = marketFromQuoteId(book.quoteId)
  const currency = currencyForMarket(market)
  const allocations = getTradeAllocations(trade)
  const batches = getStockTBatches(book)
  const originalBatchId = allocations.find((allocation) => allocation.purpose === 't')?.batchId
  const [side, setSide] = useState<TTradeSide>(trade.side)
  const [purpose, setPurpose] = useState<TTradePurpose>(
    isIndependentBaseTrade(trade) ? 'base' : 't'
  )
  const [batchId, setBatchId] = useState(
    () => originalBatchId ?? batches.find((batch) => !batch.settlement)?.id ?? 'new'
  )
  const [quantity, setQuantity] = useState(() => trade.quantity.toString())
  const [price, setPrice] = useState(() => trade.price.toString())
  const [tradedAt, setTradedAt] = useState(trade.tradedAt)
  const [fees, setFees] = useState(() => totalRecordedTradeFees(trade).toString())
  const [note, setNote] = useState(trade.note)
  const [error, setError] = useState('')
  const fixedQuantity = allocations.length > 1
  const selectableBatches = batches.filter(
    (batch) =>
      !batch.settlement || allocations.some((allocation) => allocation.batchId === batch.id)
  )

  const save = () => {
    const numericQuantity = Number(quantity)
    const numericPrice = Number(price)
    const numericFees = Number(fees)
    if (
      !tradedAt ||
      !Number.isFinite(numericPrice) ||
      numericPrice <= 0 ||
      fees.trim() === '' ||
      !Number.isFinite(numericFees) ||
      numericFees < 0
    ) {
      setError('请填写有效的成交时间、价格和费用')
      return
    }
    const quantityError = marketTradeQuantityError(market, numericQuantity)
    if (quantityError) {
      setError(quantityError)
      return
    }

    const account = book.accounts[trade.accountId!]
    const record = account.tradeRecords.find((item) => item.id === trade.id)!
    const marketDate = tradedAt.slice(0, 10)
    if (record.actualSettlementDate && record.actualSettlementDate < marketDate) {
      setError('成交日期不能晚于已记录的实际交收日')
      return
    }
    const feeTotal = roundMoney(numericFees)
    const feesChanged = feeTotal !== totalRecordedTradeFees(record)
    const sideChanged = side !== record.side
    const dateChanged = marketDate !== record.tradedAt.slice(0, 10)
    let nextTrade: TTradeRecord = {
      ...record,
      side,
      purpose: fixedQuantity ? record.purpose : purpose,
      quantity: numericQuantity,
      price: numericPrice,
      tradedAt,
      marketDate,
      note: note.trim(),
      allocations: fixedQuantity ? record.allocations : undefined,
      batchId: fixedQuantity ? record.batchId : undefined,
      batchSequence: fixedQuantity ? record.batchSequence : undefined,
      batchDirection: fixedQuantity ? record.batchDirection : undefined,
      estimatedSettlementDate: dateChanged
        ? estimateSettlementDate(market, marketDate, tradingCalendar)
        : record.estimatedSettlementDate,
      settlementRule: dateChanged
        ? settlementRuleForTradeDate(market, marketDate)
        : record.settlementRule,
      ...(feesChanged || sideChanged
        ? {
            fees: {
              commission: market === 'CN' ? feeTotal : 0,
              handling: 0,
              regulatory: 0,
              transfer: 0,
              stampDuty: 0
            },
            feeItems:
              market === 'CN'
                ? undefined
                : [{ code: 'manual' as const, label: '券商实际费用', amount: feeTotal }],
            feeSource: 'actual' as const,
            feeTemplate: undefined,
            accountFeeSnapshot: undefined
          }
        : {})
    }

    try {
      let nextBatches = batches
      if (purpose === 't' && !fixedQuantity) {
        let batch = batches.find((item) => item.id === batchId)
        if (batchId === 'new') {
          const draftAccount = withLedgerTradeRecords(
            account,
            upsertTradeRecord(account.tradeRecords, nextTrade)
          )
          const entries = activePortfolioLedgerEntries(draftAccount)
          const tradeIndex = entries.findIndex((entry) => entry.id === `trade:${record.id}`)
          const opening = calculatePortfolioLedgerPosition(
            {
              ...draftAccount,
              ledger: { ...draftAccount.ledger, entries: entries.slice(0, tradeIndex) }
            },
            market,
            currency
          )
          if (opening.error) throw new Error(`完整账本校验失败：${opening.error}`)
          batch = {
            id: crypto.randomUUID(),
            sequence: Math.max(0, ...batches.map((item) => item.sequence)) + 1,
            direction: side === 'buy' ? 'forward' : 'reverse',
            openedAt: tradedAt,
            openingPosition: opening.position,
            legacyCalibrationProfit: 0,
            buyLevels: createTPlanLevelsFromDefaults(planDefaults.buyLevels),
            sellLevels: createTPlanLevelsFromDefaults(planDefaults.sellLevels),
            alertEnabled: false,
            floatingProfitAlert: {
              enabled: false,
              threshold: floatingProfitAlertDefaultThreshold,
              status: 'armed'
            }
          } satisfies TTradingBatch
          nextBatches = [...batches, batch]
        }
        if (!batch) throw new Error('所选 T 批次已不存在，请重新选择')
        nextTrade = toTradeRecord(nextTrade, batch)
      }
      const result = isIndependentBaseTrade(nextTrade)
        ? upsertIndependentBaseTrade(account, nextTrade, market, currency, account.position)
        : (() => {
            const nextAccount = withLedgerTradeRecords(
              account,
              upsertTradeRecord(account.tradeRecords, nextTrade)
            )
            return {
              account: nextAccount,
              ...calculatePortfolioLedgerPosition(nextAccount, market, currency)
            }
          })()
      if (result.error) throw new Error(`完整账本校验失败：${result.error}`)
      const nextBook = reconcileStockTBatches(
        {
          ...book,
          tBatches: nextBatches,
          accounts: {
            ...book.accounts,
            [trade.accountId!]: { ...result.account, position: result.position }
          }
        },
        planDefaults,
        book
      )
      onApply(nextBook)
      onComplete()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <div className="t-inline-edit-form">
      <div className="t-form-grid t-inline-edit-grid">
        <label>
          <span>交易类型</span>
          <AppSelect<TTradeSide>
            label="交易类型"
            value={side}
            disabled={Boolean(trade.splitSource)}
            options={[
              { value: 'buy', label: '买入' },
              { value: 'sell', label: '卖出' }
            ]}
            onChange={setSide}
          />
        </label>
        <label className={purpose === 'base' ? 'is-wide' : undefined}>
          <span>交易用途</span>
          <AppSelect<TTradePurpose>
            label="交易用途"
            value={purpose}
            disabled={fixedQuantity}
            options={
              fixedQuantity
                ? [{ value: purpose, label: '保留原用途分配' }]
                : [
                    { value: 'base', label: side === 'buy' ? '增加底仓' : '减持底仓' },
                    { value: 't', label: 'T 仓交易' }
                  ]
            }
            onChange={setPurpose}
          />
        </label>
        {purpose === 't' ? (
          <label>
            <span>T 批次</span>
            <AppSelect
              label="交易所属 T 批次"
              value={batchId}
              disabled={fixedQuantity}
              options={[
                ...selectableBatches.map((batch) => ({
                  value: batch.id,
                  label: `${batch.direction === 'reverse' ? '反T' : '正T'}批次 #${batch.sequence}${batch.settlement ? '（已结算）' : ''}`
                })),
                { value: 'new', label: side === 'buy' ? '新建正T批次' : '新建反T批次' }
              ]}
              onChange={setBatchId}
            />
          </label>
        ) : null}
        <label>
          <span>数量</span>
          <AppInput
            type="number"
            min={market === 'CN' ? 100 : 1}
            step="100"
            autoFocus
            value={quantity}
            disabled={fixedQuantity}
            title={fixedQuantity ? '多用途成交保留原数量分配' : undefined}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <label>
          <span>价格</span>
          <AppInput
            type="number"
            min={market === 'CN' ? 0.01 : 0.0001}
            step={market === 'CN' ? 0.01 : 0.0001}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </label>
        <label>
          <span>费用</span>
          <AppInput
            type="number"
            min="0"
            step="0.01"
            value={fees}
            onChange={(event) => setFees(event.target.value)}
            aria-label="成交总费用"
          />
        </label>
        <label className="is-wide">
          <span>时间</span>
          <AppInput
            type="datetime-local"
            value={tradedAt}
            onChange={(event) => setTradedAt(event.target.value)}
          />
        </label>
        <label>
          <span>备注</span>
          <AppInput
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="可选"
          />
        </label>
      </div>
      {trade.splitSource ? (
        <div className="t-inline-edit-hint">
          同笔成交的拆分流水保留原买卖方向，避免与关联流水不一致。
        </div>
      ) : null}
      {fixedQuantity ? (
        <div className="t-inline-edit-hint">
          多用途成交保留原数量、用途分配和批次归属，可修改买卖方向。
        </div>
      ) : null}
      {side !== trade.side ? (
        <div className="t-inline-edit-hint">
          买卖方向已变更，费用按当前填写的金额保存，请确认实际成交费用。
        </div>
      ) : null}
      {error ? <div className="t-form-error">{error}</div> : null}
      <div className="t-inline-edit-actions">
        <AppButton variant="text" onClick={onComplete}>
          取消
        </AppButton>
        <AppButton variant="primary" className="compact-button" onClick={save}>
          保存修改
        </AppButton>
      </div>
    </div>
  )
}
