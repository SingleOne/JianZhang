import { useState, type ReactNode } from 'react'
import { PositionEditor, type PositionEditorProps } from './PositionEditor'
import { TTradingDrawer, type TTradingDrawerProps } from './TTradingDrawer'
import { useStockAccountScope } from './SecuritiesAccountContext'
import { AccountLedgerOverview } from './AccountLedgerOverview'
import { calculatePositionMetrics } from '../lib/portfolio'
import { calculateCurrentPositionProfitOverride } from '../lib/portfolio-performance'
import type { StockTradingBook, TTradingAccount } from '../shared/types'

type BookInput = StockTradingBook | TTradingAccount | undefined
type PositionProps = Omit<PositionEditorProps, 'account'> & {
  account: BookInput
  initialAccountId?: string
}
type TradingProps = Omit<TTradingDrawerProps, 'account'> & {
  account: BookInput
  initialAccountId?: string
}

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
      accountFeeSnapshot={scope.owner.feeSettings}
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
  const scope = useStockAccountScope(props.stock, props.initialAccountId)
  const [epoch, setEpoch] = useState(0)
  const selector = (
    <>
      {scope.selector}
      <AccountLedgerOverview
        stock={props.stock}
        onSelect={(id) => void scope.select(id)}
        onMoved={() => setEpoch((value) => value + 1)}
      />
    </>
  )
  return (
    <>
      {scope.visited.map((id) => (
        <PositionAccountDraft
          key={`${id}:${epoch}`}
          props={props}
          accountId={id}
          selector={selector}
          hidden={id !== scope.accountId}
        />
      ))}
    </>
  )
}

function TradingAccountDraft({
  props,
  accountId,
  selector,
  hidden
}: {
  props: TradingProps
  accountId: string
  selector: ReactNode
  hidden: boolean
}) {
  const scope = useStockAccountScope(props.stock, accountId)
  const profit = calculateCurrentPositionProfitOverride(
    scope.stock,
    props.quote,
    scope.book,
    props.exchangeRates,
    scope.book.performanceAdjustmentCny
  )
  const metrics = calculatePositionMetrics(
    scope.book.position,
    props.quote,
    scope.book,
    props.exchangeRates,
    profit
  )
  return (
    <TTradingDrawer
      {...props}
      hidden={hidden}
      stock={scope.stock}
      account={scope.book}
      accountDisabled={!scope.owner.enabled}
      holdingCost={metrics.holdingCost}
      holdingCostBasis={metrics.holdingCostBasis}
      feeSettings={scope.fees.tTradingFees}
      marketTradeFees={scope.fees.marketTradeFees}
      accountFeeSnapshot={scope.owner.feeSettings}
      accountSelector={selector}
    />
  )
}

export function AccountTTradingDrawer(props: TradingProps) {
  const scope = useStockAccountScope(props.stock, props.initialAccountId)
  const [epoch, setEpoch] = useState(0)
  const selector = (
    <>
      {scope.selector}
      <AccountLedgerOverview
        stock={props.stock}
        onSelect={(id) => void scope.select(id)}
        onMoved={() => setEpoch((value) => value + 1)}
      />
    </>
  )
  return (
    <>
      {scope.visited.map((id) => (
        <TradingAccountDraft
          key={`${id}:${epoch}`}
          props={props}
          accountId={id}
          selector={selector}
          hidden={id !== scope.accountId}
        />
      ))}
    </>
  )
}
