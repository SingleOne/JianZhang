import { DEFAULT_APP_SETTINGS } from '../shared/types'
import type {
  AppState,
  BrokerFeeScheme,
  CnFixedFeeRates,
  TTrade,
  TTradeFees,
  TTradeRecord
} from '../shared/types'
import { marketFromQuoteId } from '../shared/stock-market'
import { marketDateTimeInput } from '../shared/market-hours'
import { calculateSchemeExecutionFees } from './broker-fees'
import { calculateMarketTradeFeeItems, marketFeeTemplateForTradeDate } from './market-trades'
import { allocateExecutionFees } from './execution-fees'
import { totalRecordedTradeFees } from './t-trading'

export interface AccountTradeFeeContext {
  accountId: string
  accountName: string
  quoteId: string
  scheme: BrokerFeeScheme
  fixedFeeOverrides?: Partial<CnFixedFeeRates>
}
export type AccountFeeState = Pick<AppState, 'securitiesAccounts' | 'feeSchemes' | 'settings'>

export function getAccountTradeFeeContext(
  state: Pick<AppState, 'securitiesAccounts' | 'feeSchemes'>,
  accountId: string,
  quoteId: string
): AccountTradeFeeContext {
  const account = state.securitiesAccounts?.[accountId]
  const scheme = account && state.feeSchemes?.[account.feeSchemeId]
  if (
    !account ||
    !scheme ||
    scheme.market !== marketFromQuoteId(quoteId) ||
    account.market !== scheme.market
  )
    throw new Error('交易账户未绑定有效的同市场费用方案')
  return {
    accountId,
    accountName: account.name,
    quoteId,
    scheme,
    fixedFeeOverrides: account.fixedFeeOverrides
  }
}

type ExecutionInput = Pick<TTrade, 'price' | 'quantity' | 'side'> & {
  tradeDate?: string
  stampDutyExempt?: boolean
}

export function calculateAccountTradeFees(context: AccountTradeFeeContext, input: ExecutionInput) {
  const { scheme } = context
  if (scheme.market === 'CN') {
    const result = calculateSchemeExecutionFees(
      input.price,
      input.quantity,
      input.side,
      scheme,
      context.quoteId.startsWith('1.') ? 'SH' : 'SZ',
      context.fixedFeeOverrides
    )
    return { fees: result.fees, feeItems: undefined, feeTemplate: undefined, total: result.total }
  }
  const tradeDate = input.tradeDate ?? marketDateTimeInput(scheme.market).slice(0, 10)
  const feeTemplate = marketFeeTemplateForTradeDate(scheme.market, tradeDate)
  if (!feeTemplate) throw new Error('该成交日期没有内置费用模板，请填写券商实际费用')
  const fees: TTradeFees = { commission: 0, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 }
  const feeItems =
    input.price <= 0 || input.quantity <= 0
      ? []
      : calculateMarketTradeFeeItems(
          scheme.market,
          input.price * input.quantity,
          input.quantity,
          input.side,
          { ...DEFAULT_APP_SETTINGS.marketTradeFees, [scheme.market]: scheme.settings },
          { tradeDate, stampDutyExempt: input.stampDutyExempt }
        )
  return { fees, feeItems, feeTemplate, total: totalRecordedTradeFees({ fees, feeItems }) }
}

/** 只在用户主动重新估算时调用；拆分流水必须按同账户的完整成交一起计费。 */
export function reestimateTradeExecution(
  records: readonly TTradeRecord[],
  tradeId: string,
  context: AccountTradeFeeContext,
  stampDutyExempt = false
): TTradeRecord[] {
  const trade = records.find((record) => record.id === tradeId)
  if (!trade || trade.origin === 'opening-balance') throw new Error('该流水不能重新估算成交费用')
  const group = trade.splitSource
    ? records
        .filter(
          (record) =>
            record.accountId === trade.accountId && record.splitSource?.id === trade.splitSource!.id
        )
        .sort(
          (a, b) =>
            Number(b.id === trade.splitSource!.id) - Number(a.id === trade.splitSource!.id) ||
            a.id.localeCompare(b.id)
        )
    : [trade]
  const quantity = group.reduce((sum, record) => sum + record.quantity, 0)
  if (
    trade.splitSource &&
    (Math.abs(quantity - trade.splitSource.quantity) > 0.000001 ||
      group.some(
        (record) =>
          record.price !== trade.price ||
          record.side !== trade.side ||
          record.tradedAt !== trade.tradedAt
      ))
  )
    throw new Error(
      '拆分成交的流水不完整或成交数据不一致，请保留原费用；需要调整整笔成交时请重新录入'
    )
  if (trade.accountId !== context.accountId) throw new Error('重新估算必须使用该流水实际所属账户')
  const result = calculateAccountTradeFees(context, {
    price: trade.price,
    quantity,
    side: trade.side,
    tradeDate: trade.marketDate ?? trade.tradedAt.slice(0, 10),
    stampDutyExempt
  })
  const parts = allocateExecutionFees(
    result.fees,
    result.feeItems,
    group.map((record) => record.quantity)
  )
  const updates = new Map(
    group.map((record, index) => [
      record.id,
      {
        ...record,
        ...parts[index],
        feeTemplate: result.feeTemplate,
        feeSource: 'estimated' as const,
        accountFeeSnapshot: undefined
      }
    ])
  )
  return records.map((record) => updates.get(record.id) ?? record)
}
