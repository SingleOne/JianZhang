import { exchangeRateForCurrency } from '../shared/exchange-rates'
import { marketFromQuoteId, type StockCurrency, type StockMarket } from '../shared/stock-market'
import type {
  ExchangeRateSettings,
  PortfolioPerformanceAdjustments,
  PortfolioLedgerEntry,
  StockQuote,
  TTradingAccount,
  TTradingAccounts,
  WatchStock
} from '../shared/types'
import { roundMoney, totalRecordedTradeFees } from './t-trading'
import { activePortfolioLedgerEntries } from './portfolio-ledger'
import type { PositionProfitOverride } from './portfolio'

export const DEFAULT_PORTFOLIO_ACCOUNT_ID = 'default'
export const DEFAULT_PORTFOLIO_ACCOUNT_LABEL = '默认账户'

export type PortfolioPerformanceIssueCode =
  | 'missingLedger'
  | 'ledgerError'
  | 'missingQuote'
  | 'missingCurrentRate'
  | 'missingHistoricalRate'
  | 'estimatedHistoricalRate'
  | 'positionMismatch'

export const PORTFOLIO_PERFORMANCE_ISSUE_LABELS: Record<PortfolioPerformanceIssueCode, string> = {
  missingLedger: '缺少组合账本',
  ledgerError: '账本数量异常',
  missingQuote: '缺少当前行情',
  missingCurrentRate: '缺少当前人民币汇率',
  missingHistoricalRate: '缺少历史人民币汇率',
  estimatedHistoricalRate: '包含官方估算汇率',
  positionMismatch: '账本持仓与当前持仓不一致'
}

export interface ProfitComponents {
  realizedProfit: number
  unrealizedProfit: number | null
  dividendIncome: number
  withholdingTax: number
  tradeFees: number
  corporateActionFees: number
  corporateActionIncome: number
  totalProfit: number | null
}

export interface NativePerformanceSlice extends ProfitComponents {
  currency: StockCurrency
  manualAdjustment: number
  complete: boolean
}

export interface CnyProfitComponents {
  realizedProfit: number | null
  unrealizedProfit: number | null
  dividendIncome: number | null
  withholdingTax: number | null
  tradeFees: number | null
  corporateActionFees: number | null
  corporateActionIncome: number | null
  totalProfit: number | null
  priceContribution: number | null
  exchangeRateContribution: number | null
  manualAdjustment: number
}

export interface PortfolioPerformanceCurrencySlice {
  currency: StockCurrency
  native: NativePerformanceSlice
  cny: CnyProfitComponents
  complete: boolean
}

export interface PortfolioPerformanceSnapshot {
  currencySlices: PortfolioPerformanceCurrencySlice[]
  native: NativePerformanceSlice[]
  cny: CnyProfitComponents
  complete: boolean
  issues: PortfolioPerformanceIssueCode[]
}

export interface PortfolioPerformanceStockResult {
  quoteId: string
  code: string
  name: string
  market: StockMarket
  accountId: string
  accountLabel: string
  securityCurrency: StockCurrency
  quantity: number
  latest: number | null
  currentCycle: PortfolioPerformanceSnapshot
  cumulative: PortfolioPerformanceSnapshot
}

export type PortfolioPerformanceCycleStatus = 'open' | 'closed' | 'excluded' | 'unassigned'

export interface PortfolioPerformanceCycleResult extends PortfolioPerformanceSnapshot {
  id: string
  sequence: number
  startedAt: string
  endedAt?: string
  startedByPerformanceReset: boolean
  includedInCumulative: boolean
  status: PortfolioPerformanceCycleStatus
  endingQuantity: number
}

export type PortfolioPerformanceScope = 'stock' | 'market' | 'account' | 'currency' | 'portfolio'

export interface PortfolioPerformanceAggregateSummary {
  stockCount: number
  includedStockCount: number
  excludedStockCount: number
  native: NativePerformanceSlice[]
  cny: CnyProfitComponents
  issueCounts: Partial<Record<PortfolioPerformanceIssueCode, number>>
}

export interface PortfolioPerformanceAggregate {
  id: string
  label: string
  detail?: string
  scope: PortfolioPerformanceScope
  currentCycle: PortfolioPerformanceAggregateSummary
  cumulative: PortfolioPerformanceAggregateSummary
}

export interface PortfolioPerformanceReport {
  generatedAt: string
  exchangeRateDate: string | null
  accountReturnAvailable: false
  accountReturnReason: string
  stocks: PortfolioPerformanceStockResult[]
  stockRows: PortfolioPerformanceAggregate[]
  marketRows: PortfolioPerformanceAggregate[]
  accountRows: PortfolioPerformanceAggregate[]
  currencyRows: PortfolioPerformanceAggregate[]
  portfolioRow: PortfolioPerformanceAggregate
}

type ComponentKey =
  | 'realizedProfit'
  | 'unrealizedProfit'
  | 'dividendIncome'
  | 'withholdingTax'
  | 'tradeFees'
  | 'corporateActionFees'
  | 'corporateActionIncome'

const COMPONENT_KEYS: readonly ComponentKey[] = [
  'realizedProfit',
  'unrealizedProfit',
  'dividendIncome',
  'withholdingTax',
  'tradeFees',
  'corporateActionFees',
  'corporateActionIncome'
]

interface MutableNativeSlice {
  currency: StockCurrency
  values: Record<ComponentKey, number>
  unrealizedComplete: boolean
}

interface MutableCnySlice {
  values: Record<ComponentKey, number>
  complete: Record<ComponentKey, boolean>
  priceContribution: number
  exchangeRateContribution: number
  attributionComplete: boolean
}

interface MutableCurrencySlice {
  native: MutableNativeSlice
  cny: MutableCnySlice
}

function emptyValues(): Record<ComponentKey, number> {
  return {
    realizedProfit: 0,
    unrealizedProfit: 0,
    dividendIncome: 0,
    withholdingTax: 0,
    tradeFees: 0,
    corporateActionFees: 0,
    corporateActionIncome: 0
  }
}

function emptyCompleteness(): Record<ComponentKey, boolean> {
  return {
    realizedProfit: true,
    unrealizedProfit: true,
    dividendIncome: true,
    withholdingTax: true,
    tradeFees: true,
    corporateActionFees: true,
    corporateActionIncome: true
  }
}

function mutableSlice(currency: StockCurrency): MutableCurrencySlice {
  return {
    native: { currency, values: emptyValues(), unrealizedComplete: true },
    cny: {
      values: emptyValues(),
      complete: emptyCompleteness(),
      priceContribution: 0,
      exchangeRateContribution: 0,
      attributionComplete: true
    }
  }
}

function currencyForEntry(entry: PortfolioLedgerEntry, fallback: StockCurrency): StockCurrency {
  return entry.kind === 'trade'
    ? (entry.record.currency ?? entry.currency ?? fallback)
    : (entry.currency ?? fallback)
}

function historicalRate(entry: PortfolioLedgerEntry, currency: StockCurrency): number | null {
  if (currency === 'CNY') return 1
  const rate =
    entry.exchangeRate ?? (entry.kind === 'trade' ? entry.record.exchangeRate : undefined)
  return rate && rate > 0 ? rate : null
}

function totalFromComponents(values: Record<ComponentKey, number>): number {
  return (
    values.realizedProfit +
    values.unrealizedProfit +
    values.dividendIncome +
    values.corporateActionIncome -
    values.withholdingTax -
    values.tradeFees -
    values.corporateActionFees
  )
}

function rounded(value: number): number {
  return roundMoney(Math.abs(value) < 0.000_000_1 ? 0 : value)
}

function finalizeNative(
  slice: MutableNativeSlice,
  forceIncomplete = false
): NativePerformanceSlice {
  const complete = slice.unrealizedComplete && !forceIncomplete
  return {
    currency: slice.currency,
    realizedProfit: rounded(slice.values.realizedProfit),
    unrealizedProfit: complete ? rounded(slice.values.unrealizedProfit) : null,
    dividendIncome: rounded(slice.values.dividendIncome),
    withholdingTax: rounded(slice.values.withholdingTax),
    tradeFees: rounded(slice.values.tradeFees),
    corporateActionFees: rounded(slice.values.corporateActionFees),
    corporateActionIncome: rounded(slice.values.corporateActionIncome),
    totalProfit: complete ? rounded(totalFromComponents(slice.values)) : null,
    manualAdjustment: 0,
    complete
  }
}

function finalizeCny(slice: MutableCnySlice, forceIncomplete = false): CnyProfitComponents {
  const component = (key: ComponentKey): number | null =>
    slice.complete[key] && !forceIncomplete ? rounded(slice.values[key]) : null
  const values = Object.fromEntries(COMPONENT_KEYS.map((key) => [key, component(key)])) as Record<
    ComponentKey,
    number | null
  >
  const complete = COMPONENT_KEYS.every((key) => values[key] !== null)
  return {
    realizedProfit: values.realizedProfit,
    unrealizedProfit: values.unrealizedProfit,
    dividendIncome: values.dividendIncome,
    withholdingTax: values.withholdingTax,
    tradeFees: values.tradeFees,
    corporateActionFees: values.corporateActionFees,
    corporateActionIncome: values.corporateActionIncome,
    totalProfit:
      complete && !forceIncomplete
        ? rounded(totalFromComponents(values as Record<ComponentKey, number>))
        : null,
    priceContribution:
      slice.attributionComplete && !forceIncomplete ? rounded(slice.priceContribution) : null,
    exchangeRateContribution:
      slice.attributionComplete && !forceIncomplete
        ? rounded(slice.exchangeRateContribution)
        : null,
    manualAdjustment: 0
  }
}

function combineCny(components: readonly CnyProfitComponents[]): CnyProfitComponents {
  const combine = (key: ComponentKey): number | null => {
    if (components.some((item) => item[key] === null)) return null
    return rounded(components.reduce((total, item) => total + (item[key] ?? 0), 0))
  }
  const values = Object.fromEntries(COMPONENT_KEYS.map((key) => [key, combine(key)])) as Record<
    ComponentKey,
    number | null
  >
  const totalProfit = components.every((item) => item.totalProfit !== null)
    ? rounded(components.reduce((total, item) => total + (item.totalProfit ?? 0), 0))
    : null
  const priceContribution = components.every((item) => item.priceContribution !== null)
    ? rounded(components.reduce((total, item) => total + (item.priceContribution ?? 0), 0))
    : null
  const exchangeRateContribution = components.every(
    (item) => item.exchangeRateContribution !== null
  )
    ? rounded(components.reduce((total, item) => total + (item.exchangeRateContribution ?? 0), 0))
    : null
  return {
    realizedProfit: values.realizedProfit,
    unrealizedProfit: values.unrealizedProfit,
    dividendIncome: values.dividendIncome,
    withholdingTax: values.withholdingTax,
    tradeFees: values.tradeFees,
    corporateActionFees: values.corporateActionFees,
    corporateActionIncome: values.corporateActionIncome,
    totalProfit,
    priceContribution,
    exchangeRateContribution,
    manualAdjustment: rounded(components.reduce((total, item) => total + item.manualAdjustment, 0))
  }
}

function emptyIncompleteCny(): CnyProfitComponents {
  return {
    realizedProfit: null,
    unrealizedProfit: null,
    dividendIncome: null,
    withholdingTax: null,
    tradeFees: null,
    corporateActionFees: null,
    corporateActionIncome: null,
    totalProfit: null,
    priceContribution: null,
    exchangeRateContribution: null,
    manualAdjustment: 0
  }
}

function addConverted(
  slice: MutableCnySlice,
  key: ComponentKey,
  amount: number,
  rate: number | null,
  issues: Set<PortfolioPerformanceIssueCode>
): void {
  if (amount === 0) return
  if (rate === null) {
    slice.complete[key] = false
    issues.add('missingHistoricalRate')
    return
  }
  slice.values[key] += amount * rate
}

interface StockPerformanceCalculation extends PortfolioPerformanceSnapshot {
  quoteId: string
  code: string
  name: string
  market: StockMarket
  accountId: string
  accountLabel: string
  securityCurrency: StockCurrency
  quantity: number
  latest: number | null
}

interface StockPerformanceOptions {
  resetOnHoldingCycleOpen?: boolean
  entries?: readonly PortfolioLedgerEntry[]
  checkPositionMismatch?: boolean
  includeUnrealized?: boolean
}

function opensHoldingCycle(entry: PortfolioLedgerEntry, quantity: number): boolean {
  return (
    quantity <= 0.000_001 &&
    ((entry.kind === 'trade' && entry.record.side === 'buy' && entry.record.quantity > 0.000_001) ||
      (entry.kind === 'positionAdjustment' && entry.quantityAfter > 0.000_001) ||
      ((entry.kind === 'shareAdjustment' || entry.kind === 'securityConversion') &&
        entry.quantityAfter > 0.000_001) ||
      (entry.kind === 'rightsSubscription' && entry.quantity > 0.000_001))
  )
}

function stockPerformance(
  stock: WatchStock,
  quote: StockQuote | undefined,
  account: TTradingAccount | undefined,
  exchangeRates: ExchangeRateSettings,
  manualAdjustment: number,
  options: StockPerformanceOptions = {}
): StockPerformanceCalculation | null {
  const market = stock.market ?? marketFromQuoteId(stock.quoteId)
  const securityCurrency =
    account?.currency ??
    stock.currency ??
    (market === 'CN' ? 'CNY' : market === 'HK' ? 'HKD' : 'USD')
  if (!account && !stock.position) return null

  const issues = new Set<PortfolioPerformanceIssueCode>()
  const slices = new Map<StockCurrency, MutableCurrencySlice>()
  const getSlice = (currency: StockCurrency) => {
    const existing = slices.get(currency)
    if (existing) return existing
    const next = mutableSlice(currency)
    slices.set(currency, next)
    return next
  }
  getSlice(securityCurrency)

  if (!account) {
    issues.add('missingLedger')
    const incompleteNative = finalizeNative(getSlice(securityCurrency).native, true)
    return {
      quoteId: stock.quoteId,
      code: stock.code,
      name: stock.name,
      market,
      accountId: DEFAULT_PORTFOLIO_ACCOUNT_ID,
      accountLabel: DEFAULT_PORTFOLIO_ACCOUNT_LABEL,
      securityCurrency,
      quantity: stock.position?.quantity ?? 0,
      latest: quote?.latest ?? null,
      currencySlices: [
        {
          currency: securityCurrency,
          native: incompleteNative,
          cny: finalizeCny(getSlice(securityCurrency).cny, true),
          complete: false
        }
      ],
      native: [incompleteNative],
      cny: finalizeCny(getSlice(securityCurrency).cny, true),
      complete: false,
      issues: [...issues]
    }
  }

  let quantity = 0
  let nativeCost = 0
  let cnyCost = 0
  let cnyCostComplete = true
  let ledgerError = false

  const resetHoldingCycle = () => {
    slices.clear()
    issues.clear()
    nativeCost = 0
    cnyCost = 0
    cnyCostComplete = true
    ledgerError = false
  }

  const entries = options.entries ?? activePortfolioLedgerEntries(account)
  for (const entry of entries) {
    const currency = currencyForEntry(entry, securityCurrency)
    const opensNewHoldingCycle = opensHoldingCycle(entry, quantity)
    if (
      (options.resetOnHoldingCycleOpen !== false && opensNewHoldingCycle) ||
      (entry.kind === 'positionAdjustment' && entry.resetsPerformance)
    ) {
      resetHoldingCycle()
    }
    const slice = getSlice(currency)
    const rate = historicalRate(entry, currency)
    if (entry.exchangeRateEstimated && currency !== 'CNY') issues.add('estimatedHistoricalRate')

    if (entry.kind === 'trade') {
      if (currency !== securityCurrency) ledgerError = true
      const amount = entry.record.price * entry.record.quantity
      const fees = totalRecordedTradeFees(entry.record)
      slice.native.values.tradeFees += fees
      addConverted(slice.cny, 'tradeFees', fees, rate, issues)
      if (entry.record.side === 'buy') {
        quantity += entry.record.quantity
        nativeCost += amount
        if (rate === null) cnyCostComplete = false
        else cnyCost += amount * rate
        continue
      }
      if (entry.record.quantity > quantity + 0.000_001) {
        ledgerError = true
        continue
      }
      const allocatedNativeCost = quantity > 0 ? (nativeCost / quantity) * entry.record.quantity : 0
      const allocatedCnyCost = quantity > 0 ? (cnyCost / quantity) * entry.record.quantity : 0
      const nativeProfit = amount - allocatedNativeCost
      slice.native.values.realizedProfit += nativeProfit
      if (rate !== null && cnyCostComplete) {
        const acquisitionRate =
          allocatedNativeCost > 0 ? allocatedCnyCost / allocatedNativeCost : rate
        slice.cny.values.realizedProfit += amount * rate - allocatedCnyCost
        slice.cny.priceContribution += nativeProfit * acquisitionRate
        slice.cny.exchangeRateContribution += amount * (rate - acquisitionRate)
      } else {
        slice.cny.complete.realizedProfit = false
        slice.cny.attributionComplete = false
        issues.add('missingHistoricalRate')
      }
      quantity -= entry.record.quantity
      nativeCost -= allocatedNativeCost
      cnyCost -= allocatedCnyCost
      if (quantity <= 0.000_001) {
        quantity = 0
        nativeCost = 0
        cnyCost = 0
        cnyCostComplete = true
      }
      continue
    }

    if (entry.kind === 'positionAdjustment') {
      quantity = entry.quantityAfter
      nativeCost = quantity > 0 ? quantity * (entry.costAfter ?? 0) : 0
      if (nativeCost === 0) {
        cnyCost = 0
        cnyCostComplete = true
      } else if (rate === null) {
        cnyCost = 0
        cnyCostComplete = false
        issues.add('missingHistoricalRate')
      } else {
        cnyCost = nativeCost * rate
        cnyCostComplete = true
      }
      continue
    }

    if (entry.kind === 'shareAdjustment' || entry.kind === 'securityConversion') {
      quantity = entry.quantityAfter
      continue
    }

    if (entry.kind === 'rightsSubscription') {
      if (currency !== securityCurrency) ledgerError = true
      const cost = entry.cost ?? entry.quantity * entry.price
      quantity += entry.quantity
      nativeCost += cost
      if (rate === null && cost !== 0) cnyCostComplete = false
      else if (rate !== null) cnyCost += cost * rate
      slice.native.values.corporateActionFees += entry.fees
      addConverted(slice.cny, 'corporateActionFees', entry.fees, rate, issues)
      continue
    }

    if (entry.kind === 'cashDividend') {
      slice.native.values.dividendIncome += entry.amount
      addConverted(slice.cny, 'dividendIncome', entry.amount, rate, issues)
    } else if (entry.kind === 'withholdingTax') {
      slice.native.values.withholdingTax += entry.amount
      addConverted(slice.cny, 'withholdingTax', entry.amount, rate, issues)
    } else if (entry.kind === 'corporateActionFee') {
      slice.native.values.corporateActionFees += entry.amount
      addConverted(slice.cny, 'corporateActionFees', entry.amount, rate, issues)
    } else if (entry.kind === 'cashAdjustment') {
      slice.native.values.corporateActionIncome += entry.amount
      addConverted(slice.cny, 'corporateActionIncome', entry.amount, rate, issues)
    }
  }

  const securitySlice = getSlice(securityCurrency)
  if (quantity > 0 && options.includeUnrealized !== false) {
    if (quote?.latest === null || quote?.latest === undefined) {
      securitySlice.native.unrealizedComplete = false
      securitySlice.cny.complete.unrealizedProfit = false
      securitySlice.cny.attributionComplete = false
      issues.add('missingQuote')
    } else {
      const marketValue = quote.latest * quantity
      securitySlice.native.values.unrealizedProfit += marketValue - nativeCost
      const currentRate = exchangeRateForCurrency(exchangeRates, securityCurrency)
      if (currentRate === null) {
        securitySlice.cny.complete.unrealizedProfit = false
        securitySlice.cny.attributionComplete = false
        issues.add('missingCurrentRate')
      } else if (!cnyCostComplete) {
        securitySlice.cny.complete.unrealizedProfit = false
        securitySlice.cny.attributionComplete = false
        issues.add('missingHistoricalRate')
      } else {
        const nativeProfit = marketValue - nativeCost
        const acquisitionRate = nativeCost > 0 ? cnyCost / nativeCost : currentRate
        securitySlice.cny.values.unrealizedProfit += marketValue * currentRate - cnyCost
        securitySlice.cny.priceContribution += nativeProfit * acquisitionRate
        securitySlice.cny.exchangeRateContribution += marketValue * (currentRate - acquisitionRate)
      }
    }
  }

  if (ledgerError) issues.add('ledgerError')
  if (
    options.checkPositionMismatch !== false &&
    ((stock.position && Math.abs(stock.position.quantity - quantity) > 0.000_001) ||
      (!stock.position && quantity > 0.000_001))
  ) {
    issues.add('positionMismatch')
  }
  const forceIncomplete = ledgerError || issues.has('positionMismatch')
  const currencySlices = [...slices.values()]
    .map((slice): PortfolioPerformanceCurrencySlice => {
      const native = finalizeNative(slice.native, forceIncomplete)
      const calculatedCny = finalizeCny(slice.cny, forceIncomplete)
      const calculatedCnyTotalProfit = calculatedCny.totalProfit
      const adjustment = rounded(manualAdjustment)
      const appliesAdjustment =
        native.currency === securityCurrency &&
        calculatedCnyTotalProfit !== null &&
        adjustment !== 0
      const currentRate = exchangeRateForCurrency(exchangeRates, native.currency)
      const nativeAdjustment =
        appliesAdjustment && currentRate !== null ? rounded(adjustment / currentRate) : 0
      const adjustedNative =
        native.totalProfit !== null && nativeAdjustment !== 0
          ? {
              ...native,
              totalProfit: rounded(native.totalProfit + nativeAdjustment),
              manualAdjustment: nativeAdjustment
            }
          : native
      const cny = appliesAdjustment
        ? {
            ...calculatedCny,
            totalProfit: rounded(calculatedCnyTotalProfit + adjustment),
            manualAdjustment: adjustment
          }
        : calculatedCny
      return {
        currency: adjustedNative.currency,
        native: adjustedNative,
        cny,
        complete: cny.totalProfit !== null
      }
    })
    .sort((left, right) => left.currency.localeCompare(right.currency))
  const native = currencySlices.map((slice) => slice.native)
  const cny = combineCny(currencySlices.map((slice) => slice.cny))
  return {
    quoteId: stock.quoteId,
    code: stock.code,
    name: stock.name,
    market,
    accountId: DEFAULT_PORTFOLIO_ACCOUNT_ID,
    accountLabel: DEFAULT_PORTFOLIO_ACCOUNT_LABEL,
    securityCurrency,
    quantity: rounded(quantity),
    latest: quote?.latest ?? null,
    currencySlices,
    native,
    cny,
    complete: cny.totalProfit !== null,
    issues: [...issues]
  }
}

function performanceSnapshot(
  calculation: StockPerformanceCalculation
): PortfolioPerformanceSnapshot {
  return {
    currencySlices: calculation.currencySlices,
    native: calculation.native,
    cny: calculation.cny,
    complete: calculation.complete,
    issues: calculation.issues
  }
}

interface MutablePerformanceCycle {
  id: string
  sequence: number
  startedAt: string
  endedAt?: string
  startedByPerformanceReset: boolean
  entries: PortfolioLedgerEntry[]
  endingQuantity: number
}

function quantityAfterEntry(entry: PortfolioLedgerEntry, quantity: number): number {
  if (entry.kind === 'trade') {
    if (entry.record.side === 'buy') return quantity + entry.record.quantity
    return entry.record.quantity > quantity + 0.000_001
      ? quantity
      : Math.max(0, quantity - entry.record.quantity)
  }
  if (
    entry.kind === 'positionAdjustment' ||
    entry.kind === 'shareAdjustment' ||
    entry.kind === 'securityConversion'
  ) {
    return entry.quantityAfter
  }
  if (entry.kind === 'rightsSubscription') return quantity + entry.quantity
  return quantity
}

function splitPerformanceCycles(account: TTradingAccount): MutablePerformanceCycle[] {
  const cycles: MutablePerformanceCycle[] = []
  let current: MutablePerformanceCycle | undefined
  let quantity = 0
  let sequence = 0

  const finishCurrent = (endedAt?: string) => {
    if (!current || current.entries.length === 0) return
    if (endedAt) current.endedAt = endedAt
    cycles.push(current)
    current = undefined
  }

  for (const entry of activePortfolioLedgerEntries(account)) {
    const startsByReset = entry.kind === 'positionAdjustment' && entry.resetsPerformance === true
    const startsByOpening = opensHoldingCycle(entry, quantity)
    if (startsByReset) {
      finishCurrent(entry.occurredAt)
      sequence += 1
      current = {
        id: `reset:${entry.id}`,
        sequence,
        startedAt: entry.occurredAt,
        startedByPerformanceReset: true,
        entries: [],
        endingQuantity: quantity
      }
    } else if (startsByOpening) {
      finishCurrent()
      sequence += 1
      current = {
        id: `holding:${entry.id}`,
        sequence,
        startedAt: entry.occurredAt,
        startedByPerformanceReset: false,
        entries: [],
        endingQuantity: quantity
      }
    } else if (!current) {
      current = {
        id: `unassigned:${entry.id}`,
        sequence: 0,
        startedAt: entry.occurredAt,
        startedByPerformanceReset: false,
        entries: [],
        endingQuantity: quantity
      }
    }

    current.entries.push(entry)
    const previousQuantity = quantity
    quantity = quantityAfterEntry(entry, quantity)
    current.endingQuantity = quantity
    if (previousQuantity > 0.000_001 && quantity <= 0.000_001) {
      current.endedAt = entry.occurredAt
    }
  }
  finishCurrent()
  return cycles
}

export function calculatePortfolioPerformanceCycles(
  stock: WatchStock,
  quote: StockQuote | undefined,
  account: TTradingAccount | undefined,
  exchangeRates: ExchangeRateSettings,
  manualAdjustment = 0
): PortfolioPerformanceCycleResult[] {
  if (!account) return []
  const cycles = splitPerformanceCycles(account)
  let latestResetIndex = -1
  for (let index = cycles.length - 1; index >= 0; index -= 1) {
    if (!cycles[index].startedByPerformanceReset) continue
    latestResetIndex = index
    break
  }
  const latestCycleIndex = cycles.length - 1
  return cycles.map((cycle, index) => {
    const calculation = stockPerformance(
      stock,
      quote,
      account,
      exchangeRates,
      index === latestCycleIndex ? manualAdjustment : 0,
      {
        entries: cycle.entries,
        checkPositionMismatch: false,
        includeUnrealized: index === latestCycleIndex,
        resetOnHoldingCycleOpen: true
      }
    )
    if (!calculation) throw new Error('持仓周期收益计算失败')
    const includedInCumulative = latestResetIndex < 0 || index >= latestResetIndex
    const status: PortfolioPerformanceCycleStatus = !includedInCumulative
      ? 'excluded'
      : cycle.sequence === 0
        ? 'unassigned'
        : index === latestCycleIndex && cycle.endingQuantity > 0.000_001
          ? 'open'
          : 'closed'
    return {
      id: cycle.id,
      sequence: cycle.sequence,
      startedAt: cycle.startedAt,
      endedAt: cycle.endedAt,
      startedByPerformanceReset: cycle.startedByPerformanceReset,
      includedInCumulative,
      status,
      endingQuantity: rounded(cycle.endingQuantity),
      ...performanceSnapshot(calculation)
    }
  })
}

export function calculateCurrentPositionProfitOverride(
  stock: WatchStock,
  quote: StockQuote | undefined,
  account: TTradingAccount | undefined,
  exchangeRates: ExchangeRateSettings,
  manualAdjustment = 0
): PositionProfitOverride | undefined {
  if (!stock.position || !account) return undefined
  const performance = stockPerformance(stock, quote, account, exchangeRates, manualAdjustment)
  if (!performance) return undefined
  const native = performance.native.find((slice) => slice.currency === performance.securityCurrency)
  return {
    totalProfit: native?.totalProfit ?? null,
    cnyTotalProfit: performance.cny.totalProfit
  }
}

export function calculateCurrentPositionProfitOverrides(
  watchlist: readonly WatchStock[],
  quotes: readonly StockQuote[],
  accounts: TTradingAccounts,
  exchangeRates: ExchangeRateSettings,
  adjustments: Readonly<PortfolioPerformanceAdjustments> = {}
): Record<string, PositionProfitOverride> {
  const quoteMap = new Map(quotes.map((quote) => [quote.quoteId, quote]))
  return Object.fromEntries(
    watchlist.flatMap((stock) => {
      const profit = calculateCurrentPositionProfitOverride(
        stock,
        quoteMap.get(stock.quoteId),
        accounts[stock.quoteId],
        exchangeRates,
        Number.isFinite(adjustments[stock.quoteId]) ? adjustments[stock.quoteId] : 0
      )
      return profit ? [[stock.quoteId, profit] as const] : []
    })
  )
}

function mergeNativeSlices(slices: readonly NativePerformanceSlice[]): NativePerformanceSlice[] {
  const grouped = new Map<StockCurrency, NativePerformanceSlice[]>()
  for (const slice of slices) {
    grouped.set(slice.currency, [...(grouped.get(slice.currency) ?? []), slice])
  }
  return [...grouped.entries()]
    .map(([currency, items]) => {
      const complete = items.every((item) => item.complete)
      const sum = (key: Exclude<keyof ProfitComponents, 'unrealizedProfit' | 'totalProfit'>) =>
        rounded(items.reduce((total, item) => total + item[key], 0))
      const unrealizedProfit = complete
        ? rounded(items.reduce((total, item) => total + (item.unrealizedProfit ?? 0), 0))
        : null
      return {
        currency,
        realizedProfit: sum('realizedProfit'),
        unrealizedProfit,
        dividendIncome: sum('dividendIncome'),
        withholdingTax: sum('withholdingTax'),
        tradeFees: sum('tradeFees'),
        corporateActionFees: sum('corporateActionFees'),
        corporateActionIncome: sum('corporateActionIncome'),
        totalProfit: complete
          ? rounded(items.reduce((total, item) => total + (item.totalProfit ?? 0), 0))
          : null,
        manualAdjustment: rounded(items.reduce((total, item) => total + item.manualAdjustment, 0)),
        complete
      }
    })
    .sort((left, right) => left.currency.localeCompare(right.currency))
}

function issueCounts(
  snapshots: readonly PortfolioPerformanceSnapshot[]
): Partial<Record<PortfolioPerformanceIssueCode, number>> {
  const counts: Partial<Record<PortfolioPerformanceIssueCode, number>> = {}
  for (const snapshot of snapshots) {
    for (const issue of snapshot.issues) counts[issue] = (counts[issue] ?? 0) + 1
  }
  return counts
}

function aggregateStockSnapshots(
  stocks: readonly PortfolioPerformanceStockResult[],
  select: (stock: PortfolioPerformanceStockResult) => PortfolioPerformanceSnapshot
): PortfolioPerformanceAggregateSummary {
  const snapshots = stocks.map(select)
  const included = snapshots.filter((snapshot) => snapshot.complete)
  return {
    stockCount: stocks.length,
    includedStockCount: included.length,
    excludedStockCount: stocks.length - included.length,
    native: mergeNativeSlices(snapshots.flatMap((snapshot) => snapshot.native)),
    cny:
      included.length > 0
        ? combineCny(included.map((snapshot) => snapshot.cny))
        : emptyIncompleteCny(),
    issueCounts: issueCounts(snapshots)
  }
}

function aggregateStocks(
  id: string,
  label: string,
  scope: PortfolioPerformanceScope,
  stocks: readonly PortfolioPerformanceStockResult[],
  detail?: string
): PortfolioPerformanceAggregate {
  return {
    id,
    label,
    detail,
    scope,
    currentCycle: aggregateStockSnapshots(stocks, (stock) => stock.currentCycle),
    cumulative: aggregateStockSnapshots(stocks, (stock) => stock.cumulative)
  }
}

function aggregateCurrencySnapshots(
  currency: StockCurrency,
  stocks: readonly PortfolioPerformanceStockResult[],
  select: (stock: PortfolioPerformanceStockResult) => PortfolioPerformanceSnapshot
): PortfolioPerformanceAggregateSummary {
  const members = stocks.flatMap((stock) => {
    const snapshot = select(stock)
    const slice = snapshot.currencySlices.find((item) => item.currency === currency)
    return slice ? [{ stock, snapshot, slice }] : []
  })
  const included = members.filter(({ slice }) => slice.complete)
  const memberSnapshots = members.map(({ snapshot }) => snapshot)
  return {
    stockCount: new Set(members.map(({ stock }) => stock.quoteId)).size,
    includedStockCount: new Set(included.map(({ stock }) => stock.quoteId)).size,
    excludedStockCount:
      new Set(members.map(({ stock }) => stock.quoteId)).size -
      new Set(included.map(({ stock }) => stock.quoteId)).size,
    native: mergeNativeSlices(members.map(({ slice }) => slice.native)),
    cny:
      included.length > 0
        ? combineCny(included.map(({ slice }) => slice.cny))
        : emptyIncompleteCny(),
    issueCounts: issueCounts(memberSnapshots)
  }
}

function aggregateCurrency(
  currency: StockCurrency,
  stocks: readonly PortfolioPerformanceStockResult[]
): PortfolioPerformanceAggregate {
  return {
    id: currency,
    label: currency,
    detail: '按原始发生币种汇总',
    scope: 'currency',
    currentCycle: aggregateCurrencySnapshots(currency, stocks, (stock) => stock.currentCycle),
    cumulative: aggregateCurrencySnapshots(currency, stocks, (stock) => stock.cumulative)
  }
}

export function calculatePortfolioPerformanceReport(
  watchlist: readonly WatchStock[],
  quotes: readonly StockQuote[],
  accounts: TTradingAccounts,
  exchangeRates: ExchangeRateSettings,
  adjustments: Readonly<PortfolioPerformanceAdjustments> = {}
): PortfolioPerformanceReport {
  const quoteMap = new Map(quotes.map((quote) => [quote.quoteId, quote]))
  const stocks = watchlist
    .flatMap((stock): PortfolioPerformanceStockResult[] => {
      const manualAdjustment = Number.isFinite(adjustments[stock.quoteId])
        ? adjustments[stock.quoteId]
        : 0
      const currentCycle = stockPerformance(
        stock,
        quoteMap.get(stock.quoteId),
        accounts[stock.quoteId],
        exchangeRates,
        manualAdjustment
      )
      if (!currentCycle) return []
      const cumulative = stockPerformance(
        stock,
        quoteMap.get(stock.quoteId),
        accounts[stock.quoteId],
        exchangeRates,
        manualAdjustment,
        { resetOnHoldingCycleOpen: false }
      )
      if (!cumulative) return []
      return [
        {
          quoteId: currentCycle.quoteId,
          code: currentCycle.code,
          name: currentCycle.name,
          market: currentCycle.market,
          accountId: currentCycle.accountId,
          accountLabel: currentCycle.accountLabel,
          securityCurrency: currentCycle.securityCurrency,
          quantity: currentCycle.quantity,
          latest: currentCycle.latest,
          currentCycle: performanceSnapshot(currentCycle),
          cumulative: performanceSnapshot(cumulative)
        }
      ]
    })
    .sort(
      (left, right) =>
        left.market.localeCompare(right.market) || left.code.localeCompare(right.code)
    )
  const stockRows = stocks.map((stock) =>
    aggregateStocks(stock.quoteId, stock.name, 'stock', [stock], `${stock.code} · ${stock.market}`)
  )
  const marketRows = (['CN', 'HK', 'US'] as const).flatMap((market) => {
    const members = stocks.filter((stock) => stock.market === market)
    if (members.length === 0) return []
    const label = market === 'CN' ? 'A股' : market === 'HK' ? '港股' : '美股'
    return [aggregateStocks(market, label, 'market', members)]
  })
  const accountRows = stocks.length
    ? [
        aggregateStocks(
          DEFAULT_PORTFOLIO_ACCOUNT_ID,
          DEFAULT_PORTFOLIO_ACCOUNT_LABEL,
          'account',
          stocks,
          '全部持仓账本'
        )
      ]
    : []
  const currencies = [
    ...new Set(
      stocks.flatMap((stock) =>
        [...stock.currentCycle.native, ...stock.cumulative.native].map((item) => item.currency)
      )
    )
  ]
  const currencyRows = currencies.sort().map((currency) => aggregateCurrency(currency, stocks))
  return {
    generatedAt: new Date().toISOString(),
    exchangeRateDate: exchangeRates.rateDate,
    accountReturnAvailable: false,
    accountReturnReason: '尚未记录完整入金、出金和现金余额，仅展示持仓收益；账户收益不计算。',
    stocks,
    stockRows,
    marketRows,
    accountRows,
    currencyRows,
    portfolioRow: aggregateStocks('portfolio', '全部组合', 'portfolio', stocks)
  }
}
