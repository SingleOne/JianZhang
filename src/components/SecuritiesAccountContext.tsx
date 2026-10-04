import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  accountFeeSettings,
  getStockAccountBook,
  listAccountsForMarket,
  resolveAccountSelection
} from '../shared/stock-accounts'
import { currencyForMarket, marketFromQuoteId } from '../shared/stock-market'
import type { AppState, TTradingAccount, WatchStock } from '../shared/types'
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
      : resolveAccountSelection(state, market)
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
      : resolveAccountSelection(state, market)
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
    <label className="securities-account-selector">
      <span>股票账户</span>
      <select value={accountId} onChange={(event) => void select(event.target.value)}>
        {listAccountsForMarket(state.securitiesAccounts, market, true).map((account) => (
          <option value={account.id} key={account.id}>
            {account.name}
            {account.enabled ? '' : '（已停用）'}
          </option>
        ))}
      </select>
      <small>持仓、交易与做 T 按账户独立管理</small>
    </label>
  )
  return {
    state,
    owner,
    book,
    accountId,
    visited,
    select,
    selector,
    markDirty: () => {},
    saved: () => {},
    stock: { ...stock, position: book.position, positionSnapshots: book.positionSnapshots },
    fees: accountFeeSettings(owner, state.settings)
  }
}
