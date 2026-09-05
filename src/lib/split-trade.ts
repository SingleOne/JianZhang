import type { TTradeRecord, TTradingBatch } from '../shared/types'
import { toTradeRecord } from './trade-records'

/** 按用途拆分成交，费用沿用整笔实收金额，不重新套用最低佣金。 */
export function splitTradeForOverflow(
  trade: TTradeRecord,
  closingBatch: TTradingBatch,
  closingQuantity: number,
  overflowBatch?: TTradingBatch
): [TTradeRecord, TTradeRecord] {
  if (closingQuantity <= 0 || closingQuantity >= trade.quantity) {
    throw new Error('拆分数量必须大于零且小于整笔成交数量')
  }

  let totalCents = 0
  let closingCents = 0
  const splitFee = (amount: number): [number, number] => {
    const cents = Math.round(amount * 100)
    totalCents += cents
    const nextClosingCents = Math.round((totalCents * closingQuantity) / trade.quantity)
    const allocatedCents = nextClosingCents - closingCents
    closingCents = nextClosingCents
    return [allocatedCents / 100, (cents - allocatedCents) / 100]
  }

  const closingFees = { ...trade.fees }
  const overflowFees = { ...trade.fees }
  for (const key of ['commission', 'handling', 'regulatory', 'transfer', 'stampDuty'] as const) {
    const [closingAmount, overflowAmount] = splitFee(trade.fees[key])
    closingFees[key] = closingAmount
    overflowFees[key] = overflowAmount
  }
  const splitFeeItems = trade.feeItems?.map((item) => {
    const [closingAmount, overflowAmount] = splitFee(item.amount)
    return [
      { ...item, amount: closingAmount },
      { ...item, amount: overflowAmount }
    ] as const
  })
  const {
    allocations: _allocations,
    batchId: _batchId,
    batchSequence: _batchSequence,
    batchDirection: _batchDirection,
    ...common
  } = trade
  const splitSource = trade.splitSource ?? { id: trade.id, quantity: trade.quantity }

  return [
    toTradeRecord(
      {
        ...common,
        purpose: 't',
        quantity: closingQuantity,
        fees: closingFees,
        feeItems: splitFeeItems?.map(([item]) => item),
        splitSource
      },
      closingBatch
    ),
    toTradeRecord(
      {
        ...common,
        id: crypto.randomUUID(),
        purpose: overflowBatch ? 't' : 'base',
        quantity: trade.quantity - closingQuantity,
        fees: overflowFees,
        feeItems: splitFeeItems?.map(([, item]) => item),
        splitSource
      },
      overflowBatch
    )
  ]
}
