import { useMemo, useState } from 'react'
import { formatCost, formatMoney, formatMoneyProfit } from '../lib/format'
import type { PortfolioPerformanceCycleResult } from '../lib/portfolio-performance'
import { totalRecordedTradeFees } from '../lib/t-trading'
import { getTradeAllocations } from '../lib/trade-records'
import type { PortfolioLedgerEntry, StockCurrency } from '../shared/types'
import { AppButton } from './AppButton'

const PAGE_SIZE = 20

interface CycleRecordDisplay {
  type: string
  context: string
  quantity: string
  price: string
  amount: number | null
  fees: number | null
  cashFlow: number | null
  note: string
  feeDetails?: string
}

function shares(value: number): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 6 })
}

function recordDisplay(entry: PortfolioLedgerEntry): CycleRecordDisplay {
  const display: CycleRecordDisplay = {
    type: '',
    context: '公司行动',
    quantity: '—',
    price: '—',
    amount: null,
    fees: null,
    cashFlow: null,
    note: entry.note || '—'
  }
  switch (entry.kind) {
    case 'trade': {
      const record = entry.record
      const opening = record.origin === 'opening-balance'
      const amount = record.quantity * record.price
      const fees = totalRecordedTradeFees(record)
      return {
        ...display,
        type: opening ? '期初持仓' : record.side === 'buy' ? '买入' : '卖出',
        context: opening
          ? '期初基准'
          : getTradeAllocations(record)
              .map((allocation) => {
                const label =
                  allocation.purpose === 'base'
                    ? '底仓'
                    : `${allocation.batchDirection === 'reverse' ? '反T' : '正T'}${allocation.batchSequence === undefined ? '' : ` #${allocation.batchSequence}`}`
                return `${label} ${shares(allocation.quantity)} 股`
              })
              .join(' / '),
        quantity: shares(record.quantity),
        price: formatCost(record.price),
        amount: opening ? null : amount,
        fees: opening ? null : fees,
        cashFlow: opening ? null : record.side === 'buy' ? -(amount + fees) : amount - fees,
        note: record.note || entry.note || '—',
        feeDetails: record.feeItems
          ?.map((item) => `${item.label} ${item.amount.toFixed(2)}`)
          .join(' · ')
      }
    }
    case 'cashDividend':
      return {
        ...display,
        type: '现金分红',
        quantity: shares(entry.eligibleQuantity),
        price: formatCost(entry.amountPerShare),
        amount: entry.amount,
        cashFlow: entry.amount
      }
    case 'withholdingTax':
      return { ...display, type: '扣税', amount: entry.amount, cashFlow: -entry.amount }
    case 'corporateActionFee':
      return { ...display, type: '公司行动费用', amount: entry.amount, cashFlow: -entry.amount }
    case 'cashAdjustment':
      return {
        ...display,
        type: {
          fractionalShare: '碎股补偿',
          manual: '现金调整',
          rightsSale: '售权款',
          delisting: '退市现金',
          capitalReturn: '资本返还'
        }[entry.reason],
        amount: entry.amount,
        cashFlow: entry.amount
      }
    case 'rightsSubscription': {
      const amount = entry.cost ?? entry.quantity * entry.price
      return {
        ...display,
        type: '配股认购',
        quantity: shares(entry.quantity),
        price: formatCost(entry.price),
        amount,
        fees: entry.fees,
        cashFlow: -(amount + entry.fees)
      }
    }
    case 'shareAdjustment':
      return {
        ...display,
        type: { stockDividend: '送转股份', split: '拆股', reverseSplit: '合股' }[entry.actionType],
        quantity: `${shares(entry.quantityBefore)} → ${shares(entry.quantityAfter)}`
      }
    case 'securityConversion':
      return {
        ...display,
        type: '股份转换',
        quantity: `${shares(entry.quantityBefore)} → ${shares(entry.quantityAfter)}`
      }
    case 'positionAdjustment':
      return {
        ...display,
        type: entry.resetsPerformance ? '收益基准重置' : '持仓校准',
        context: '持仓与成本基准',
        quantity: `${shares(entry.quantityBefore)} → ${shares(entry.quantityAfter)}`,
        price: `${formatCost(entry.costBefore)} → ${formatCost(entry.costAfter)}`
      }
    case 'reversal':
      return { ...display, type: '冲销记录' }
  }
}

export default function PortfolioPerformanceCycleRecords({
  cycle,
  currency,
  accountLabel,
  tradeCount,
  id
}: {
  cycle: PortfolioPerformanceCycleResult
  currency: StockCurrency
  accountLabel: string
  tradeCount: number
  id: string
}) {
  const [page, setPage] = useState(0)
  const entries = useMemo(() => [...cycle.entries].reverse(), [cycle.entries])
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const visibleEntries = entries.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

  return (
    <section className="performance-cycle-records" id={id} aria-label="本周期交易明细">
      <div className="performance-cycle-records-heading">
        <strong>{cycle.sequence === 0 ? '未归属事件' : `第 ${cycle.sequence} 期`}明细</strong>
        <span>
          {accountLabel} · 买卖成交 {tradeCount} 笔 · 其他流水 {entries.length - tradeCount} 条 ·
          时间倒序
        </span>
      </div>
      {cycle.cny.manualAdjustment !== 0 ? (
        <div className="performance-cycle-records-adjustment">
          本期手动收益调整：
          <strong className={cycle.cny.manualAdjustment > 0 ? 'is-up' : 'is-down'}>
            {formatMoneyProfit(cycle.cny.manualAdjustment, 'CNY')}
          </strong>
        </div>
      ) : null}
      <div className="performance-cycle-records-scroll">
        <table className="performance-cycle-records-table">
          <thead>
            <tr>
              <th scope="col">时间</th>
              <th scope="col">类型</th>
              <th scope="col">底仓 / T批次</th>
              <th scope="col">数量 / 变化</th>
              <th scope="col">成交价 / 每股基准</th>
              <th scope="col">成交 / 事件金额</th>
              <th scope="col">交易费用</th>
              <th scope="col">实际收支</th>
              <th scope="col">币种</th>
              <th scope="col">备注</th>
            </tr>
          </thead>
          <tbody>
            {visibleEntries.map((entry) => {
              const display = recordDisplay(entry)
              const record = entry.kind === 'trade' ? entry.record : undefined
              const entryCurrency = record?.currency ?? entry.currency ?? currency
              return (
                <tr key={entry.id}>
                  <td>{(record?.tradedAt ?? entry.occurredAt).replace('T', ' ').slice(0, 19)}</td>
                  <td>{display.type}</td>
                  <td className="performance-cycle-record-context">{display.context}</td>
                  <td>{display.quantity}</td>
                  <td>{display.price}</td>
                  <td>{formatMoney(display.amount, entryCurrency)}</td>
                  <td title={display.feeDetails}>{formatMoney(display.fees, entryCurrency)}</td>
                  <td>{formatMoneyProfit(display.cashFlow, entryCurrency)}</td>
                  <td>{entryCurrency}</td>
                  <td className="performance-cycle-record-note">{display.note}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="performance-cycle-records-footer">
        <span>
          共 {entries.length} 条 · 每页 {PAGE_SIZE} 条
        </span>
        <div className="performance-cycle-records-pagination" aria-label="周期交易明细分页">
          <AppButton disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
            上一页
          </AppButton>
          <span aria-live="polite">
            {currentPage + 1} / {pageCount}
          </span>
          <AppButton
            disabled={currentPage === pageCount - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            下一页
          </AppButton>
        </div>
      </div>
    </section>
  )
}
