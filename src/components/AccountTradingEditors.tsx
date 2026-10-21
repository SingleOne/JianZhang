import { useState, type ReactNode } from 'react'
import { PositionEditor, type PositionEditorProps } from './PositionEditor'
import { TTradingDrawer, type TTradingDrawerProps } from './TTradingDrawer'
import { StockAccountBoundary, useStockAccountScope } from './SecuritiesAccountContext'
import type { StockTradingBook, TTradingAccount } from '../shared/types'
import { reconcileStockTBatches, toStockTradingBook } from '../lib/stock-t-trading'
import { calculatePortfolioLedgerPosition } from '../lib/portfolio-ledger'

type BookInput = StockTradingBook | TTradingAccount | undefined
type PositionProps = Omit<
  PositionEditorProps,
  'account' | 'tradingBook' | 'accountRevision' | 'onAccountChange' | 'onBookChange' | 'onSave'
> & {
  account: BookInput
  initialAccountId?: string
  onSave: (book: StockTradingBook, showRadarSignals: boolean) => Promise<boolean>
}
type TradingProps = TTradingDrawerProps

function PositionAccountDraft({
  props,
  accountId,
  selector,
  hidden,
  tradingBook,
  accountRevision,
  onAccountChange,
  onBookChange
}: {
  props: PositionProps
  accountId: string
  selector: ReactNode
  hidden: boolean
  tradingBook: StockTradingBook
  accountRevision: number
  onAccountChange: (account: TTradingAccount) => void
  onBookChange: (book: StockTradingBook) => void
}) {
  const scope = useStockAccountScope(props.stock, accountId)
  const book = tradingBook.accounts[accountId] ?? scope.book
  return (
    <PositionEditor
      {...props}
      hidden={hidden}
      stock={{ ...scope.stock, position: book.position }}
      account={book}
      tradingBook={tradingBook}
      accountRevision={accountRevision}
      onAccountChange={onAccountChange}
      onBookChange={onBookChange}
      accountDisabled={!scope.owner.enabled}
      marketTradeFees={scope.fees.marketTradeFees}
      accountSelector={selector}
      onSave={async (position, radar, snapshots, account) => {
        const nextBook = reconcileStockTBatches(
          {
            ...tradingBook,
            accounts: {
              ...tradingBook.accounts,
              [accountId]: {
                ...(account ?? book),
                position,
                positionSnapshots: snapshots
              }
            }
          },
          props.planDefaults,
          tradingBook
        )
        for (const child of Object.values(nextBook.accounts)) {
          const replay = calculatePortfolioLedgerPosition(child, child.market!, child.currency!)
          if (replay.error)
            throw new Error(`${child.accountName ?? child.accountId}：${replay.error}`)
          nextBook.accounts[child.accountId!] = { ...child, position: replay.position }
        }
        onAccountChange(nextBook.accounts[accountId])
        return props.onSave(nextBook, radar)
      }}
    />
  )
}

export function AccountPositionEditor(props: PositionProps) {
  return (
    <StockAccountBoundary stock={props.stock} onClose={props.onClose}>
      <PositionEditorWithAccounts {...props} />
    </StockAccountBoundary>
  )
}

function PositionEditorWithAccounts(props: PositionProps) {
  const scope = useStockAccountScope(props.stock, props.initialAccountId)
  const [tradingBook, setTradingBook] = useState(() =>
    toStockTradingBook(props.account, props.stock.quoteId)
  )
  const [accountRevisions, setAccountRevisions] = useState<Record<string, number>>({})
  const [draftNotice, setDraftNotice] = useState('')
  const updateAccount = (account: TTradingAccount) => {
    setTradingBook((current) => ({
      ...current,
      accounts: { ...current.accounts, [account.accountId!]: account }
    }))
  }
  const updateBook = (book: StockTradingBook) => {
    const affectedIds = Object.keys(book.accounts).filter(
      (id) => book.accounts[id] !== tradingBook.accounts[id]
    )
    setTradingBook(book)
    setAccountRevisions((current) => ({
      ...current,
      ...Object.fromEntries(affectedIds.map((id) => [id, (current[id] ?? 0) + 1]))
    }))
    setDraftNotice('删除已更新到草稿，受影响账户的持仓已重算；保存设置后生效。')
  }
  return (
    <>
      {scope.visited.map((id) => (
        <PositionAccountDraft
          key={id}
          accountId={id}
          selector={scope.selector}
          hidden={id !== scope.accountId}
          tradingBook={tradingBook}
          accountRevision={accountRevisions[id] ?? 0}
          onAccountChange={updateAccount}
          onBookChange={updateBook}
          props={{ ...props, draftNotice }}
        />
      ))}
    </>
  )
}

export function AccountTTradingDrawer(props: TradingProps) {
  return (
    <StockAccountBoundary stock={props.stock} onClose={props.onClose}>
      <TTradingDrawer {...props} />
    </StockAccountBoundary>
  )
}
