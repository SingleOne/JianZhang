import { useAppStateField } from '../lib/data-center/hooks'
import CorporateActionPanel, { type CorporateActionPanelProps } from './CorporateActionPanel'
import { useStockAccountScope } from './StockAccountScope'
import { listAccountsForMarket } from '../shared/stock-accounts'
import { marketFromQuoteId } from '../shared/stock-market'
import type { StockTradingBook, TTradingAccount } from '../shared/types'

type PanelProps = Omit<
  CorporateActionPanelProps,
  'account' | 'accountOptions' | 'onAccountChange'
> & {
  account?: StockTradingBook | TTradingAccount
}
export default function AccountCorporateActionPanel(props: PanelProps) {
  const securitiesAccounts = useAppStateField('securitiesAccounts')
  const market = props.stock.market ?? marketFromQuoteId(props.stock.quoteId)
  if (listAccountsForMarket(securitiesAccounts, market, true).length) {
    return <CorporateActionWithAccounts {...props} />
  }
  return <CorporateActionPanel {...props} account={undefined} />
}

function CorporateActionWithAccounts(props: PanelProps) {
  const scope = useStockAccountScope(props.stock)
  const market = props.stock.market ?? marketFromQuoteId(props.stock.quoteId)
  return (
    <CorporateActionPanel
      {...props}
      stock={scope.stock}
      account={scope.book}
      accountDisabled={!scope.owner.enabled}
      accountOptions={listAccountsForMarket(scope.securitiesAccounts, market, true).map(
        (owner) => ({
          value: owner.id,
          label: `${owner.name}${owner.enabled ? '' : '（已停用）'}`
        })
      )}
      onAccountChange={(id) => void scope.select(id)}
      onCommit={(account, position, record) =>
        props.onCommit(account, position, { ...record, accountId: scope.accountId })
      }
      onRecordChange={(record) => props.onRecordChange({ ...record, accountId: scope.accountId })}
    />
  )
}
