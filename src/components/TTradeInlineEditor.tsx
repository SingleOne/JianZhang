import { useState } from 'react'
import { upsertIndependentBaseTrade } from '../lib/base-trades'
import {
  estimateSettlementDate,
  marketTradeQuantityError,
  settlementRuleForTradeDate
} from '../lib/market-trades'
import { calculatePortfolioLedgerPosition } from '../lib/portfolio-ledger'
import { reconcileStockTBatches } from '../lib/stock-t-trading'
import { roundMoney, totalRecordedTradeFees } from '../lib/t-trading'
import {
  getTradeAllocations,
  isIndependentBaseTrade,
  upsertTradeRecord
} from '../lib/trade-records'
import { currencyForMarket, marketFromQuoteId } from '../shared/stock-market'
import { withLedgerTradeRecords } from '../shared/types'
import type {
  StockTradingBook,
  TPlanDefaultSettings,
  TTrade,
  TradingCalendarSettings
} from '../shared/types'
import { AppButton } from './AppButton'
import { AppInput } from './AppFormControls'

interface Props {
  book: StockTradingBook
  trade: TTrade
  planDefaults: TPlanDefaultSettings
  tradingCalendar: TradingCalendarSettings
  onApply: (book: StockTradingBook) => void
  onComplete: () => void
}

export function TTradeInlineEditor({
  book,
  trade,
  planDefaults,
  tradingCalendar,
  onApply,
  onComplete
}: Props) {
  const market = marketFromQuoteId(book.quoteId)
  const currency = currencyForMarket(market)
  const [quantity, setQuantity] = useState(() => trade.quantity.toString())
  const [price, setPrice] = useState(() => trade.price.toString())
  const [tradedAt, setTradedAt] = useState(trade.tradedAt)
  const [fees, setFees] = useState(() => totalRecordedTradeFees(trade).toString())
  const [note, setNote] = useState(trade.note)
  const [error, setError] = useState('')
  const fixedQuantity = getTradeAllocations(trade).length > 1

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
    const dateChanged = marketDate !== record.tradedAt.slice(0, 10)
    const nextTrade = {
      ...record,
      quantity: numericQuantity,
      price: numericPrice,
      tradedAt,
      marketDate,
      note: note.trim(),
      allocations:
        record.allocations?.length === 1
          ? [{ ...record.allocations[0], quantity: numericQuantity }]
          : record.allocations,
      estimatedSettlementDate: dateChanged
        ? estimateSettlementDate(market, marketDate, tradingCalendar)
        : record.estimatedSettlementDate,
      settlementRule: dateChanged
        ? settlementRuleForTradeDate(market, marketDate)
        : record.settlementRule,
      ...(feesChanged
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
