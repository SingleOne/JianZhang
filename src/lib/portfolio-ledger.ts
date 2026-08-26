import { roundMoney, totalRecordedTradeFees } from './t-trading'
import type {
  CashAdjustmentLedgerEntry,
  CorporateActionCandidate,
  CorporateActionConfirmation,
  CorporateActionImpactPreview,
  CorporateActionMarketRules,
  PortfolioLedgerEntry,
  ReversalLedgerEntry,
  StockCurrency,
  StockMarket,
  TTradingAccount,
  TTradeRecord
} from '../shared/types'

export const CORPORATE_ACTION_MARKET_RULES: Record<StockMarket, CorporateActionMarketRules> = {
  CN: {
    market: 'CN',
    quantityPrecision: 0,
    cashPrecision: 2,
    supportsFractionalShares: false,
    defaultWithholdingTaxMode: 'brokerActual',
    dateTimeZone: 'Asia/Shanghai',
    settlementRuleIds: ['cn-standard-settlement']
  },
  HK: {
    market: 'HK',
    quantityPrecision: 6,
    cashPrecision: 2,
    supportsFractionalShares: false,
    defaultWithholdingTaxMode: 'brokerActual',
    dateTimeZone: 'Asia/Hong_Kong',
    settlementRuleIds: ['hkex-standard-settlement']
  },
  US: {
    market: 'US',
    quantityPrecision: 6,
    cashPrecision: 2,
    supportsFractionalShares: true,
    defaultWithholdingTaxMode: 'brokerActual',
    dateTimeZone: 'America/New_York',
    settlementRuleIds: ['us-standard-settlement']
  }
}

export interface PortfolioLedgerMetrics {
  quantity: number
  nativeCostBasis: number
  cnyCostBasis: number | null
  averageCost: number | null
  averageCostCny: number | null
  realizedProfit: number
  realizedProfitCny: number | null
  cashIncome: number
  cashIncomeCny: number | null
  error?: string
}

function entryDate(entry: PortfolioLedgerEntry): string {
  return entry.marketDate || entry.occurredAt.slice(0, 10)
}

function tradeDate(record: TTradeRecord): string {
  return (
    record.actualSettlementDate ??
    record.estimatedSettlementDate ??
    record.marketDate ??
    record.tradedAt.slice(0, 10)
  )
}

export function activePortfolioLedgerEntries(account: TTradingAccount): PortfolioLedgerEntry[] {
  const reversedIds = new Set(
    account.ledger.entries.flatMap((entry) =>
      entry.kind === 'reversal' ? [entry.reversesEntryId] : []
    )
  )
  return account.ledger.entries
    .filter((entry) => entry.kind !== 'reversal' && !reversedIds.has(entry.id))
    .sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) ||
        (left.recordedAt ?? left.occurredAt).localeCompare(right.recordedAt ?? right.occurredAt) ||
        left.id.localeCompare(right.id)
    )
}

function entryRate(entry: PortfolioLedgerEntry, currency: StockCurrency): number | null {
  if (currency === 'CNY') return 1
  return entry.exchangeRate && entry.exchangeRate > 0 ? entry.exchangeRate : null
}

export function calculatePortfolioLedgerMetrics(
  account: TTradingAccount,
  currency: StockCurrency
): PortfolioLedgerMetrics {
  let quantity = 0
  let nativeCostBasis = 0
  let cnyCostBasis = 0
  let completeCnyCost = true
  let realizedProfit = 0
  let realizedProfitCny = 0
  let cashIncome = 0
  let cashIncomeCny = 0
  let completeCashCny = true

  for (const entry of activePortfolioLedgerEntries(account)) {
    if (entry.kind === 'trade') {
      const record = entry.record
      const fees = totalRecordedTradeFees(record)
      const amount = record.price * record.quantity
      const rate = entryRate(entry, currency)
      if (record.side === 'buy') {
        quantity += record.quantity
        nativeCostBasis += amount + fees
        if (rate === null) completeCnyCost = false
        else cnyCostBasis += (amount + fees) * rate
        continue
      }
      if (record.quantity > quantity) {
        return {
          quantity,
          nativeCostBasis,
          cnyCostBasis: completeCnyCost ? cnyCostBasis : null,
          averageCost: quantity > 0 ? nativeCostBasis / quantity : null,
          averageCostCny: quantity > 0 && completeCnyCost ? cnyCostBasis / quantity : null,
          realizedProfit,
          realizedProfitCny: completeCnyCost ? realizedProfitCny : null,
          cashIncome,
          cashIncomeCny: completeCashCny ? cashIncomeCny : null,
          error: '卖出数量不能超过组合账本中的可用持仓数量'
        }
      }
      const nativeAllocated = quantity > 0 ? (nativeCostBasis / quantity) * record.quantity : 0
      const cnyAllocated = quantity > 0 ? (cnyCostBasis / quantity) * record.quantity : 0
      realizedProfit += amount - fees - nativeAllocated
      if (rate === null || !completeCnyCost) completeCnyCost = false
      else realizedProfitCny += (amount - fees) * rate - cnyAllocated
      quantity -= record.quantity
      nativeCostBasis -= nativeAllocated
      cnyCostBasis -= cnyAllocated
      continue
    }

    if (entry.kind === 'shareAdjustment' || entry.kind === 'securityConversion') {
      quantity = entry.quantityAfter
      continue
    }

    if (entry.kind === 'rightsSubscription') {
      const cost = (entry.cost ?? entry.quantity * entry.price) + entry.fees
      const rate = entryRate(entry, currency)
      quantity += entry.quantity
      nativeCostBasis += cost
      if (rate === null) completeCnyCost = false
      else cnyCostBasis += cost * rate
      continue
    }

    if (
      entry.kind === 'cashDividend' ||
      entry.kind === 'withholdingTax' ||
      entry.kind === 'corporateActionFee' ||
      entry.kind === 'cashAdjustment'
    ) {
      const amount =
        entry.kind === 'cashDividend' || entry.kind === 'cashAdjustment'
          ? entry.amount
          : -entry.amount
      const rate = entryRate(entry, currency)
      cashIncome += amount
      if (rate === null) completeCashCny = false
      else cashIncomeCny += amount * rate
    }
  }

  return {
    quantity,
    nativeCostBasis: roundMoney(nativeCostBasis),
    cnyCostBasis: completeCnyCost ? roundMoney(cnyCostBasis) : null,
    averageCost: quantity > 0 ? nativeCostBasis / quantity : null,
    averageCostCny: quantity > 0 && completeCnyCost ? cnyCostBasis / quantity : null,
    realizedProfit: roundMoney(realizedProfit),
    realizedProfitCny: completeCnyCost ? roundMoney(realizedProfitCny) : null,
    cashIncome: roundMoney(cashIncome),
    cashIncomeCny: completeCashCny ? roundMoney(cashIncomeCny) : null
  }
}

export function eligibleQuantityOn(account: TTradingAccount, date: string | undefined): number {
  if (!date) return calculatePortfolioLedgerMetrics(account, account.currency ?? 'CNY').quantity
  let quantity = 0
  for (const entry of activePortfolioLedgerEntries(account)) {
    if (entry.kind === 'trade') {
      if (tradeDate(entry.record) > date) continue
      quantity += entry.record.side === 'buy' ? entry.record.quantity : -entry.record.quantity
    } else if (
      (entry.kind === 'shareAdjustment' || entry.kind === 'securityConversion') &&
      entryDate(entry) <= date
    ) {
      quantity = entry.quantityAfter
    } else if (entry.kind === 'rightsSubscription' && entryDate(entry) <= date) {
      quantity += entry.quantity
    }
  }
  return Math.max(0, quantity)
}

function extractedNumber(
  candidate: CorporateActionCandidate,
  key: 'amountPerShare' | 'oldShares' | 'newShares' | 'subscriptionPrice'
): number | undefined {
  if (candidate.terms.kind === 'cashDividend' && key === 'amountPerShare') {
    return candidate.terms.amountPerShare.value
  }
  if (
    (candidate.terms.kind === 'shareRatio' || candidate.terms.kind === 'securityConversion') &&
    (key === 'oldShares' || key === 'newShares')
  ) {
    return candidate.terms[key].value
  }
  if (candidate.terms.kind === 'rightsIssue' && key === 'subscriptionPrice') {
    return candidate.terms.subscriptionPrice.value
  }
  return undefined
}

function extractedCurrency(candidate: CorporateActionCandidate): StockCurrency | undefined {
  return candidate.terms.kind === 'cashDividend' || candidate.terms.kind === 'rightsIssue'
    ? candidate.terms.currency.value
    : undefined
}

function baseEntry(
  candidate: CorporateActionCandidate,
  confirmation: CorporateActionConfirmation,
  suffix: string
) {
  const occurredAt =
    confirmation.occurredAt ??
    `${candidate.payableDate ?? candidate.effectiveDate ?? candidate.exDate ?? candidate.announcementDate}T00:00:00.000Z`
  return {
    id: `corporate-action:${candidate.id}:${candidate.contentHash.slice(0, 10)}:${suffix}`,
    accountId: candidate.quoteId,
    quoteId: candidate.quoteId,
    occurredAt,
    marketDate: occurredAt.slice(0, 10),
    recordedAt: candidate.detectedAt,
    source: 'corporateAction' as const,
    externalId: candidate.providerEventId,
    corporateActionId: candidate.id,
    currency: confirmation.currency ?? extractedCurrency(candidate),
    exchangeRate: confirmation.exchangeRate,
    exchangeRateDate: confirmation.exchangeRateDate,
    exchangeRateEstimated: confirmation.exchangeRateEstimated,
    note: confirmation.note ?? candidate.title
  }
}

export function previewCorporateAction(
  candidate: CorporateActionCandidate,
  account: TTradingAccount,
  confirmation: CorporateActionConfirmation
): CorporateActionImpactPreview {
  const currency =
    confirmation.currency ?? extractedCurrency(candidate) ?? account.currency ?? 'CNY'
  const before = calculatePortfolioLedgerMetrics(account, currency)
  const reversedIds = new Set(
    account.ledger.entries.flatMap((entry) =>
      entry.kind === 'reversal' ? [entry.reversesEntryId] : []
    )
  )
  const previousEntries = account.ledger.entries.filter(
    (entry) =>
      entry.kind !== 'reversal' &&
      entry.corporateActionId === candidate.id &&
      !reversedIds.has(entry.id)
  )
  const quantityBefore = before.quantity
  const costBefore = before.averageCost
  const totalCostBefore = before.nativeCostBasis
  const entries: PortfolioLedgerEntry[] = []
  const missingFields: string[] = []
  let quantityAfter = quantityBefore
  let grossCash = 0
  const withholdingTax = Math.max(0, confirmation.withholdingTax ?? 0)
  const fees = Math.max(0, confirmation.fees ?? 0)
  const previousTax = previousEntries.reduce(
    (total, entry) => total + (entry.kind === 'withholdingTax' ? entry.amount : 0),
    0
  )
  const previousFees = previousEntries.reduce(
    (total, entry) =>
      total +
      (entry.kind === 'corporateActionFee'
        ? entry.amount
        : entry.kind === 'rightsSubscription'
          ? entry.fees
          : 0),
    0
  )
  const taxDelta = roundMoney(withholdingTax - previousTax)
  const feeDelta = roundMoney(fees - previousFees)

  if (candidate.type === 'cashDividend' || candidate.type === 'returnOfCapital') {
    const eligibleQuantity =
      confirmation.eligibleQuantity ??
      eligibleQuantityOn(account, candidate.recordDate ?? candidate.exDate)
    const amountPerShare =
      confirmation.amountPerShare ?? extractedNumber(candidate, 'amountPerShare')
    if (!(eligibleQuantity >= 0)) missingFields.push('权益股数')
    if (!(amountPerShare && amountPerShare > 0)) missingFields.push('每股金额')
    if (!confirmation.currency && !extractedCurrency(candidate)) missingFields.push('币种')
    if (missingFields.length === 0 && amountPerShare) {
      const desiredGrossCash = roundMoney(eligibleQuantity * amountPerShare)
      const previousGrossCash = previousEntries.reduce(
        (total, entry) =>
          total +
          (entry.kind === 'cashDividend' ||
          (entry.kind === 'cashAdjustment' && entry.reason === 'capitalReturn')
            ? entry.amount
            : 0),
        0
      )
      grossCash = roundMoney(desiredGrossCash - previousGrossCash)
      if (grossCash !== 0 || previousGrossCash === 0) {
        entries.push({
          ...baseEntry(candidate, { ...confirmation, currency }, 'cash-dividend'),
          kind: candidate.type === 'cashDividend' ? 'cashDividend' : 'cashAdjustment',
          ...(candidate.type === 'cashDividend'
            ? { eligibleQuantity, amountPerShare, amount: grossCash }
            : { amount: grossCash, reason: 'capitalReturn' as const })
        } as PortfolioLedgerEntry)
      }
    }
  } else if (
    candidate.type === 'stockDividend' ||
    candidate.type === 'split' ||
    candidate.type === 'reverseSplit'
  ) {
    const oldShares = confirmation.oldShares ?? extractedNumber(candidate, 'oldShares')
    const newShares = confirmation.newShares ?? extractedNumber(candidate, 'newShares')
    if (!(oldShares && oldShares > 0)) missingFields.push('旧股比例')
    if (!(newShares && newShares > 0)) missingFields.push('新股比例')
    if (oldShares && newShares) {
      const previousAdjustment = previousEntries.find((entry) => entry.kind === 'shareAdjustment')
      const originalQuantity =
        previousAdjustment?.kind === 'shareAdjustment'
          ? previousAdjustment.quantityBefore
          : quantityBefore
      quantityAfter = (originalQuantity * newShares) / oldShares
      if (quantityAfter !== quantityBefore || !previousAdjustment) {
        entries.push({
          ...baseEntry(candidate, confirmation, 'share-adjustment'),
          kind: 'shareAdjustment',
          actionType: candidate.type,
          quantityBefore,
          quantityAfter,
          oldShares,
          newShares
        })
      }
    }
  } else if (candidate.type === 'rightsIssue') {
    const subscribedQuantity = confirmation.subscribedQuantity
    const subscriptionPrice =
      confirmation.subscriptionPrice ?? extractedNumber(candidate, 'subscriptionPrice')
    if (subscribedQuantity === undefined) missingFields.push('认购数量（不参与时填 0）')
    if ((subscribedQuantity ?? 0) > 0 && !(subscriptionPrice && subscriptionPrice > 0)) {
      missingFields.push('认购价')
    }
    const previousSubscriptionQuantity = previousEntries.reduce(
      (total, entry) => total + (entry.kind === 'rightsSubscription' ? entry.quantity : 0),
      0
    )
    const previousSubscriptionCost = previousEntries.reduce(
      (total, entry) =>
        total +
        (entry.kind === 'rightsSubscription' ? (entry.cost ?? entry.quantity * entry.price) : 0),
      0
    )
    const subscriptionDelta = (subscribedQuantity ?? 0) - previousSubscriptionQuantity
    const desiredSubscriptionCost =
      subscribedQuantity !== undefined && subscriptionPrice
        ? roundMoney(subscribedQuantity * subscriptionPrice)
        : 0
    const subscriptionCostDelta = roundMoney(desiredSubscriptionCost - previousSubscriptionCost)
    if (
      (subscriptionDelta !== 0 || subscriptionCostDelta !== 0 || feeDelta !== 0) &&
      !subscriptionPrice
    ) {
      missingFields.push('原认购价')
    }
    if (
      (subscriptionDelta !== 0 || subscriptionCostDelta !== 0 || feeDelta !== 0) &&
      subscriptionPrice
    ) {
      quantityAfter += subscriptionDelta
      grossCash = -subscriptionCostDelta
      entries.push({
        ...baseEntry(candidate, { ...confirmation, currency }, 'rights-subscription'),
        kind: 'rightsSubscription',
        quantity: subscriptionDelta,
        price: subscriptionPrice,
        cost: subscriptionCostDelta,
        fees: feeDelta
      })
    }
  } else if (candidate.type === 'symbolChange' || candidate.type === 'mergerExchange') {
    const oldShares = confirmation.oldShares ?? extractedNumber(candidate, 'oldShares') ?? 1
    const newShares = confirmation.newShares ?? extractedNumber(candidate, 'newShares') ?? 1
    const previousConversion = previousEntries.find((entry) => entry.kind === 'securityConversion')
    const originalQuantity =
      previousConversion?.kind === 'securityConversion'
        ? previousConversion.quantityBefore
        : quantityBefore
    quantityAfter = (originalQuantity * newShares) / oldShares
    if (quantityAfter !== quantityBefore || !previousConversion) {
      entries.push({
        ...baseEntry(candidate, confirmation, 'security-conversion'),
        kind: 'securityConversion',
        quantityBefore,
        quantityAfter,
        sourceQuoteId: candidate.quoteId,
        targetQuoteId: confirmation.targetQuoteId
      })
    }
  } else if (candidate.type === 'manualCash' || candidate.type === 'delistingCash') {
    if (!Number.isFinite(confirmation.cashAmount)) missingFields.push('现金金额')
    if (Number.isFinite(confirmation.cashAmount)) {
      const previousCash = previousEntries.reduce(
        (total, entry) => total + (entry.kind === 'cashAdjustment' ? entry.amount : 0),
        0
      )
      grossCash = roundMoney(confirmation.cashAmount! - previousCash)
      const entry: CashAdjustmentLedgerEntry = {
        ...baseEntry(candidate, { ...confirmation, currency }, 'cash-adjustment'),
        kind: 'cashAdjustment',
        amount: grossCash,
        reason: candidate.type === 'delistingCash' ? 'delisting' : 'manual'
      }
      entries.push(entry)
    }
  } else {
    missingFields.push('该事件需根据券商通知手工补录实际结果')
  }

  if (taxDelta !== 0) {
    entries.push({
      ...baseEntry(candidate, { ...confirmation, currency }, 'withholding-tax'),
      kind: 'withholdingTax',
      amount: taxDelta
    })
  }
  if (feeDelta !== 0 && candidate.type !== 'rightsIssue') {
    entries.push({
      ...baseEntry(candidate, { ...confirmation, currency }, 'fee'),
      kind: 'corporateActionFee',
      amount: feeDelta
    })
  }

  const netCash = roundMoney(grossCash - taxDelta - feeDelta)
  const netCashCny = confirmation.exchangeRate
    ? roundMoney(netCash * confirmation.exchangeRate)
    : currency === 'CNY'
      ? netCash
      : null
  return {
    candidateId: candidate.id,
    quantityBefore,
    quantityAfter,
    costBefore,
    costAfter: quantityAfter > 0 ? totalCostBefore / quantityAfter : null,
    totalCostBefore,
    totalCostAfter: totalCostBefore,
    grossCash,
    withholdingTax: taxDelta,
    fees: feeDelta,
    netCash,
    netCashCny,
    entries,
    missingFields
  }
}

export function reversalEntries(
  candidate: CorporateActionCandidate,
  account: TTradingAccount
): ReversalLedgerEntry[] {
  const occurredAt = new Date().toISOString()
  const appliedIds = new Set(candidate.appliedEntryIds ?? [])
  return account.ledger.entries
    .filter((entry) => appliedIds.has(entry.id))
    .map((entry) => ({
      id: `reversal:${entry.id}`,
      accountId: account.quoteId,
      quoteId: account.quoteId,
      occurredAt,
      marketDate: occurredAt.slice(0, 10),
      recordedAt: occurredAt,
      source: 'corporateAction',
      corporateActionId: candidate.id,
      kind: 'reversal',
      reversesEntryId: entry.id,
      note: `撤销：${candidate.title}`
    }))
}
