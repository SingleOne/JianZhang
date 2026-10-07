import type { TTradeFees, TradeFeeItem } from '../shared/types'

const FEE_KEYS = ['commission', 'handling', 'regulatory', 'transfer', 'stampDuty'] as const

/** 按数量分配整笔费用，以分为单位保持每个费用项及各部分总额守恒。 */
export function allocateExecutionFees(
  fees: TTradeFees,
  feeItems: readonly TradeFeeItem[] | undefined,
  quantities: readonly number[]
): Array<{ fees: TTradeFees; feeItems: TradeFeeItem[] | undefined }> {
  const quantity = quantities.reduce((sum, value) => sum + value, 0)
  if (!quantities.length || quantities.some((value) => !Number.isFinite(value) || value <= 0))
    throw new Error('费用分摊数量必须为正数')
  const amounts = [
    ...FEE_KEYS.map((key) => fees[key]),
    ...(feeItems ?? []).map((item) => item.amount)
  ]
  if (amounts.some((amount) => !Number.isFinite(amount) || amount < 0))
    throw new Error('费用必须为有效的非负金额')
  const cents = amounts.map((amount) => Math.round(amount * 100))
  let remainingTotal = cents.reduce((sum, value) => sum + value, 0)
  let cumulativeQuantity = 0
  let assigned = 0
  const budgets = quantities.map((value, index) => {
    cumulativeQuantity += value
    const target =
      index === quantities.length - 1
        ? remainingTotal
        : Math.round((remainingTotal * cumulativeQuantity) / quantity)
    const budget = target - assigned
    assigned = target
    return budget
  })
  const allocated = cents.map((amount) => {
    let cumulativeBudget = 0
    let assignedAmount = 0
    const row = budgets.map((budget, index) => {
      cumulativeBudget += budget
      const target =
        index === budgets.length - 1
          ? amount
          : remainingTotal > 0
            ? Math.round((amount * cumulativeBudget) / remainingTotal)
            : 0
      const part = target - assignedAmount
      assignedAmount = target
      return part
    })
    row.forEach((part, index) => {
      budgets[index] -= part
    })
    remainingTotal -= amount
    return row
  })
  return quantities.map((_, index) => ({
    fees: Object.fromEntries(
      FEE_KEYS.map((key, row) => [key, allocated[row][index] / 100])
    ) as unknown as TTradeFees,
    feeItems: feeItems?.map((item, row) => ({
      ...item,
      amount: allocated[FEE_KEYS.length + row][index] / 100
    }))
  }))
}
