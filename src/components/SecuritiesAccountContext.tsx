import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  accountFeeSettings,
  getStockAccountBook,
  listAccountsForMarket,
  resolveAccountSelection
} from '../shared/stock-accounts'
import { currencyForMarket, marketFromQuoteId, STOCK_MARKET_LABELS } from '../shared/stock-market'
import type { AppState, TTradingAccount, WatchStock } from '../shared/types'
import { AppSelect } from './AppSelect'
import './SecuritiesAccounts.css'

type AccountContextState = AppState & {
  clearAccountNavigation: () => void
  commitAccountState: (state: AppState) => Promise<boolean>
  accountNavigation?: { quoteId: string; accountId: string }
}
const AccountContext = createContext<AccountContextState | null>(null)

export function SecuritiesAccountProvider({
  state,
  children,
  onSave,
  accountNavigation,
  onNavigationHandled
}: {
  state: AppState
  children: ReactNode
  onNavigationHandled: () => void
  onSave: (state: AppState) => Promise<boolean>
  accountNavigation?: { quoteId: string; accountId: string }
}) {
  return (
    <AccountContext.Provider
      value={{
        ...state,
        commitAccountState: onSave,
        accountNavigation,
        clearAccountNavigation: onNavigationHandled
      }}
    >
      {children}
    </AccountContext.Provider>
  )
}

export function useSecuritiesAccountState(): AccountContextState {
  const state = useContext(AccountContext)
  if (!state) throw new Error('股票账户上下文尚未加载')
  return state
}

function AccountRequiredDialog({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', escape)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', escape)
    }
  }, [onClose])
  return createPortal(
    <div className="account-manager-backdrop" onMouseDown={onClose} role="presentation">
      <section
        className="account-manager account-required-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="请先创建股票账户"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2>请先创建股票账户</h2>
        </header>
        <p className="account-manager-notice">{message}</p>
        <footer>
          <button type="button" className="primary-button" onClick={onClose}>
            关闭
          </button>
        </footer>
      </section>
    </div>,
    document.body
  )
}

export function StockAccountBoundary({
  stock,
  children,
  onClose
}: {
  stock: WatchStock
  children: ReactNode
  onClose?: () => void
}) {
  const state = useSecuritiesAccountState()
  const market = stock.market ?? marketFromQuoteId(stock.quoteId)
  if (listAccountsForMarket(state.securitiesAccounts, market, true).length) return children
  const message = `${STOCK_MARKET_LABELS[market]}暂无股票账户，请在设置的“管理股票账户”中新增账户。`
  return onClose ? (
    <AccountRequiredDialog message={message} onClose={onClose} />
  ) : (
    <p className="securities-account-empty">{message}</p>
  )
}

export function useStockAccountScope(stock: WatchStock, preferredId?: string) {
  const state = useSecuritiesAccountState()
  const market = stock.market ?? marketFromQuoteId(stock.quoteId)
  const [selection, setSelection] = useState(() => {
    const preferred =
      preferredId ??
      (state.accountNavigation?.quoteId === stock.quoteId
        ? state.accountNavigation.accountId
        : undefined)
    return preferred && state.securitiesAccounts?.[preferred]?.market === market
      ? preferred
      : resolveAccountSelection(state, market) ||
          listAccountsForMarket(state.securitiesAccounts, market, true)[0].id
  })
  const [visited, setVisited] = useState<string[]>([selection])
  const consumedNavigation = useRef<typeof state.accountNavigation>(undefined)
  useEffect(() => {
    if (consumedNavigation.current === state.accountNavigation) return
    consumedNavigation.current = state.accountNavigation
    const id =
      state.accountNavigation?.quoteId === stock.quoteId
        ? state.accountNavigation.accountId
        : undefined
    if (!preferredId && id && state.securitiesAccounts?.[id]?.market === market) {
      setSelection(id)
      setVisited((current) => (current.includes(id) ? current : [...current, id]))
    }
  }, [state.accountNavigation, preferredId, stock.quoteId, market, state.securitiesAccounts])
  const accountId =
    state.securitiesAccounts?.[selection]?.market === market
      ? selection
      : resolveAccountSelection(state, market) ||
        listAccountsForMarket(state.securitiesAccounts, market, true)[0].id
  const owner = state.securitiesAccounts![accountId]
  const existing = getStockAccountBook(state.stockTradingBooks, stock.quoteId, accountId)
  const book: TTradingAccount = existing ?? {
    accountId,
    accountName: owner.name,
    quoteId: stock.quoteId,
    code: stock.code,
    name: stock.name,
    market,
    currency: stock.currency ?? currencyForMarket(market),
    history: [],
    ledger: { schemaVersion: 1, entries: [] },
    tradeRecords: []
  }
  const select = async (next: string) => {
    if (next === accountId) return
    setVisited((current) => (current.includes(next) ? current : [...current, next]))
    setSelection(next)
  }
  const selector = (
    <div className="securities-account-selector">
      <span>股票账户</span>
      <AppSelect
        value={accountId}
        label="股票账户"
        className="securities-account-select"
        options={listAccountsForMarket(state.securitiesAccounts, market, true).map((account) => ({
          value: account.id,
          label: `${account.name}${account.enabled ? '' : '（已停用）'}`
        }))}
        onChange={(id) => void select(id)}
      />
      <small>持仓、交易与做 T 按账户独立管理</small>
    </div>
  )
  return {
    state,
    owner,
    book,
    accountId,
    visited: [...new Set([...visited, accountId])].filter(
      (id) => state.securitiesAccounts?.[id]?.market === market
    ),
    select,
    selector,
    markDirty: () => {},
    saved: () => {},
    stock: { ...stock, position: book.position, positionSnapshots: book.positionSnapshots },
    fees: accountFeeSettings(owner, state.settings)
  }
}
