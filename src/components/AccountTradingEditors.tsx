import type { ReactNode } from 'react'
import { PositionEditor, type PositionEditorProps } from './PositionEditor'
import { TTradingDrawer, type TTradingDrawerProps } from './TTradingDrawer'
import { StockAccountBoundary, useStockAccountScope } from './SecuritiesAccountContext'
import type { StockTradingBook, TTradingAccount } from '../shared/types'

type BookInput = StockTradingBook | TTradingAccount | undefined
type PositionProps = Omit<PositionEditorProps, 'account'> & {
  account: BookInput
  initialAccountId?: string
}
type TradingProps = TTradingDrawerProps

function PositionAccountDraft({
  props,
  accountId,
  selector,
  hidden
}: {
  props: PositionProps
  accountId: string
  selector: ReactNode
  hidden: boolean
}) {
  const scope = useStockAccountScope(props.stock, accountId)
  return (
    <PositionEditor
      {...props}
      hidden={hidden}
      stock={scope.stock}
      account={scope.book}
      accountDisabled={!scope.owner.enabled}
      marketTradeFees={scope.fees.marketTradeFees}
      accountSelector={selector}
      onSave={(position, radar, snapshots, account) =>
        props.onSave(position, radar, snapshots, {
          ...(account ?? scope.book),
          position,
          positionSnapshots: snapshots
        })
      }
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
  return (
    <>
      {scope.visited.map((id) => (
        <PositionAccountDraft
          key={id}
          props={props}
          accountId={id}
          selector={scope.selector}
          hidden={id !== scope.accountId}
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
