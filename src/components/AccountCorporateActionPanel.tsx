import CorporateActionPanel, { type CorporateActionPanelProps } from './CorporateActionPanel'
import { StockAccountBoundary, useStockAccountScope } from './SecuritiesAccountContext'
import { recordsForAccount } from '../shared/stock-accounts'
import type { StockTradingBook, TTradingAccount } from '../shared/types'

type PanelProps = Omit<CorporateActionPanelProps, 'account'> & {
  account?: StockTradingBook | TTradingAccount
}
function AccountDraft({
  props,
  accountId,
  hidden
}: {
  props: PanelProps
  accountId: string
  hidden: boolean
}) {
  const scope = useStockAccountScope(props.stock, accountId)
  return (
    <CorporateActionPanel
      {...props}
      hidden={hidden}
      stock={scope.stock}
      account={scope.book}
      accountDisabled={!scope.owner.enabled}
      records={recordsForAccount(props.records, accountId)}
      onCommit={(account, position, record) =>
        props.onCommit(account, position, { ...record, accountId })
      }
      onRecordChange={(record) => props.onRecordChange({ ...record, accountId })}
    />
  )
}
export default function AccountCorporateActionPanel(props: PanelProps) {
  return (
    <StockAccountBoundary stock={props.stock}>
      <CorporateActionWithAccounts {...props} />
    </StockAccountBoundary>
  )
}

function CorporateActionWithAccounts(props: PanelProps) {
  const scope = useStockAccountScope(props.stock)
  return (
    <>
      {scope.selector}
      {scope.visited.map((id) => (
        <AccountDraft key={id} props={props} accountId={id} hidden={id !== scope.accountId} />
      ))}
    </>
  )
}
