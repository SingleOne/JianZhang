import { useState } from 'react'
import { useConfirmDialog } from './ConfirmDialog'
import { moveAccountLedgerEntry } from '../lib/stock-accounts'
import { listAccountsForMarket } from '../shared/stock-accounts'
import { useSecuritiesAccountState } from './SecuritiesAccountContext'
import { listStockAccountBooks } from '../shared/stock-accounts'
import { formatMoney, formatShares, formatCost } from '../lib/format'
import { totalRecordedTradeFees } from '../lib/t-trading'
import { activePortfolioLedgerEntries } from '../lib/portfolio-ledger'
import type { WatchStock } from '../shared/types'
import { getActiveStockTBatches } from '../shared/stock-t-batches'
import { getBatchTrades } from '../lib/trade-records'
import { AppButton } from './AppButton'
import { AppInput } from './AppFormControls'
import { AppSelect } from './AppSelect'

export function AccountLedgerOverview({
  stock,
  onSelect,
  onMoved
}: {
  stock: WatchStock
  onSelect: (accountId: string) => void
  onMoved?: () => void
}) {
  const state = useSecuritiesAccountState()
  const confirm = useConfirmDialog()
  const [error, setError] = useState('')
  const [recalculateFees, setRecalculateFees] = useState(false)
  const books = listStockAccountBooks(state.stockTradingBooks[stock.quoteId])
  const parent = state.stockTradingBooks[stock.quoteId]
  const activeBatches = getActiveStockTBatches(parent)
  const entries = books
    .flatMap((book) => activePortfolioLedgerEntries(book).map((entry) => ({ book, entry })))
    .sort((a, b) => b.entry.occurredAt.localeCompare(a.entry.occurredAt))
  return (
    <details className="account-ledger-overview">
      <summary>全部账户概览与流水</summary>
      <div className="account-table-scroll">
        <table>
          <thead>
            <tr>
              <th>账户</th>
              <th>持仓数量</th>
              <th>成本价</th>
              <th>做 T</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {books.map((book) => (
              <tr key={book.accountId}>
                <td>{book.accountName}</td>
                <td>{formatShares(book.position?.quantity ?? 0)}</td>
                <td>{formatCost(book.position?.cost)}</td>
                <td>
                  {activeBatches
                    .filter((batch) =>
                      getBatchTrades(parent, batch).some(
                        (trade) => trade.accountId === book.accountId
                      )
                    )
                    .map((batch) => `批次 #${batch.sequence}`)
                    .join('、') || '—'}
                </td>
                <td>
                  <AppButton
                    variant="text"
                    className="text-button"
                    onClick={() => onSelect(book.accountId!)}
                  >
                    查看账户
                  </AppButton>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>股票合计（只读）</th>
              <td>{formatShares(stock.position?.quantity ?? 0)}</td>
              <td>{formatCost(stock.position?.cost)}</td>
              <td colSpan={2}>{activeBatches.length} 个 T 批次进行中</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <label>
        <AppInput
          type="checkbox"
          checked={recalculateFees}
          onChange={(event) => setRecalculateFees(event.target.checked)}
        />
        更正账户时按目标账户重算费用（默认保留原费用）
      </label>
      <div className="account-table-scroll">
        <table>
          <thead>
            <tr>
              <th>账户</th>
              <th>时间</th>
              <th>类型</th>
              <th>数量 / 金额</th>
              <th>价格</th>
              <th>费用</th>
              <th>更正账户</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(({ book, entry }) => (
              <tr key={`${book.accountId}:${entry.id}`}>
                <td>{book.accountName}</td>
                <td>{entry.occurredAt.replace('T', ' ').slice(0, 19)}</td>
                <td>
                  {entry.kind === 'trade'
                    ? entry.record.side === 'buy'
                      ? '买入'
                      : '卖出'
                    : entry.kind === 'positionAdjustment'
                      ? '持仓校准'
                      : entry.kind === 'cashDividend'
                        ? '分红'
                        : entry.kind === 'withholdingTax'
                          ? '缴税'
                          : '公司行动'}
                </td>
                <td>
                  {entry.kind === 'trade'
                    ? formatShares(entry.record.quantity)
                    : 'amount' in entry
                      ? formatMoney(entry.amount, entry.currency ?? book.currency ?? 'CNY')
                      : 'quantityAfter' in entry
                        ? formatShares(entry.quantityAfter)
                        : '—'}
                </td>
                <td>{entry.kind === 'trade' ? formatCost(entry.record.price) : '—'}</td>
                <td>
                  {entry.kind === 'trade'
                    ? formatMoney(totalRecordedTradeFees(entry.record), book.currency ?? 'CNY')
                    : '—'}
                </td>
                <td>
                  {(entry.kind === 'trade' &&
                    entry.record.origin !== 'opening-balance' &&
                    (entry.record.allocations?.length ?? 0) <= 1 &&
                    !entry.record.splitSource &&
                    !entry.record.brokerImport) ||
                  ((entry.kind === 'cashDividend' || entry.kind === 'withholdingTax') &&
                    entry.source === 'manual') ? (
                    <AppSelect
                      label="更正流水所属账户"
                      value=""
                      options={[
                        { value: '', label: '选择目标账户' },
                        ...listAccountsForMarket(state.securitiesAccounts, book.market!)
                          .filter((account) => account.id !== book.accountId)
                          .map((account) => ({ value: account.id, label: account.name }))
                      ]}
                      onChange={async (targetId) => {
                        if (!targetId) return
                        if (
                          !(await confirm({
                            title: '更正流水账户',
                            message: `将这条流水从 ${book.accountName} 更正到 ${state.securitiesAccounts?.[targetId]?.name}，${entry.kind === 'trade' && recalculateFees ? '按目标账户当前方案重新计费' : '保留原费用'}，并更新两个账户的持仓成本与相关批次收益。`,
                            confirmLabel: '确认更正'
                          }))
                        )
                          return
                        try {
                          const next = moveAccountLedgerEntry(
                            state,
                            stock.quoteId,
                            book.accountId!,
                            targetId,
                            entry.id,
                            recalculateFees
                          )
                          if (!(await state.commitAccountState(next))) throw new Error('保存失败')
                          setError('')
                          onMoved?.()
                        } catch (reason) {
                          setError(reason instanceof Error ? reason.message : '账户更正失败')
                        }
                      }}
                    />
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? (
        <p className="account-manager-error" role="alert">
          {error}
        </p>
      ) : null}
    </details>
  )
}
