import type {
  GlobalFinancialMetric,
  GlobalFinancialMetricId,
  GlobalFinancialPeriod
} from '../shared/types'

export interface StructuredFactUnit {
  start?: string
  end?: string
  val?: number
  accn?: string
  fy?: number
  fp?: string
  form?: string
  filed?: string
}

export interface StructuredCompanyFacts {
  facts?: Record<
    string,
    Record<string, { label?: string; units?: Record<string, StructuredFactUnit[]> }>
  >
}

export interface FilingSource {
  accessionNumber: string
  url: string
}

interface MetricDefinition {
  id: GlobalFinancialMetricId
  label: string
  concepts: string[]
  perShare?: boolean
}

interface SelectedFact {
  metric: GlobalFinancialMetric
  entry: StructuredFactUnit
}

const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    id: 'revenue',
    label: '营业收入',
    concepts: [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'SalesRevenueNet',
      'Revenues',
      'Revenue'
    ]
  },
  { id: 'grossProfit', label: '毛利润', concepts: ['GrossProfit'] },
  {
    id: 'operatingIncome',
    label: '营业利润',
    concepts: ['OperatingIncomeLoss', 'ProfitLossFromOperatingActivities']
  },
  {
    id: 'netIncome',
    label: '净利润',
    concepts: ['NetIncomeLoss', 'ProfitLoss', 'ProfitLossAttributableToOwnersOfParent']
  },
  {
    id: 'dilutedEps',
    label: '稀释每股收益',
    concepts: ['EarningsPerShareDiluted', 'DilutedEarningsLossPerShare'],
    perShare: true
  },
  { id: 'totalAssets', label: '总资产', concepts: ['Assets'] },
  { id: 'totalLiabilities', label: '总负债', concepts: ['Liabilities'] },
  {
    id: 'stockholdersEquity',
    label: '股东权益',
    concepts: [
      'StockholdersEquity',
      'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
      'Equity'
    ]
  },
  {
    id: 'cashAndEquivalents',
    label: '现金及等价物',
    concepts: [
      'CashAndCashEquivalentsAtCarryingValue',
      'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
      'CashAndCashEquivalents'
    ]
  },
  {
    id: 'totalDebt',
    label: '有息负债',
    concepts: [
      'LongTermDebtAndFinanceLeaseObligationsCurrent',
      'LongTermDebtCurrent',
      'LongTermDebtNoncurrent',
      'LongTermDebt'
    ]
  },
  {
    id: 'operatingCashFlow',
    label: '经营现金流',
    concepts: [
      'NetCashProvidedByUsedInOperatingActivities',
      'CashFlowsFromUsedInOperatingActivities'
    ]
  },
  {
    id: 'capitalExpenditure',
    label: '资本开支',
    concepts: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PurchaseOfPropertyPlantAndEquipment']
  }
]

const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A'])
const INTERIM_FORMS = new Set(['10-Q', '10-Q/A'])
const ADDITIVE_METRICS = new Set<GlobalFinancialMetricId>([
  'revenue',
  'grossProfit',
  'operatingIncome',
  'netIncome',
  'operatingCashFlow',
  'capitalExpenditure',
  'freeCashFlow'
])

function durationDays(entry: StructuredFactUnit): number | null {
  if (!entry.start || !entry.end) return null
  return Math.round((new Date(entry.end).getTime() - new Date(entry.start).getTime()) / 86_400_000)
}

function isCurrencyUnit(unit: string): boolean {
  return /^[A-Z]{3}$/.test(unit)
}

function makeMetric(
  definition: MetricDefinition,
  concept: string,
  unit: string,
  value: number
): GlobalFinancialMetric {
  return {
    id: definition.id,
    label: definition.label,
    value,
    unit: definition.perShare ? 'perShare' : 'currency',
    currency: unit.split('/')[0],
    derivation: 'reported',
    rawConcept: concept
  }
}

function collectFacts(
  payload: StructuredCompanyFacts,
  acceptedForms: Set<string>,
  periodType: 'annual' | 'interim'
): Map<string, SelectedFact[]> {
  const periods = new Map<string, SelectedFact[]>()
  for (const definition of METRIC_DEFINITIONS) {
    let matchedConcept = false
    for (const namespace of Object.values(payload.facts ?? {})) {
      for (const concept of definition.concepts) {
        const fact = namespace[concept]
        if (!fact) continue
        const candidates = Object.entries(fact.units ?? {}).flatMap(([unit, entries]) => {
          if (!(isCurrencyUnit(unit) || (definition.perShare && unit.includes('/shares'))))
            return []
          return entries.flatMap((entry): Array<{ unit: string; entry: StructuredFactUnit }> => {
            if (!entry.end || !entry.filed || !entry.form || !acceptedForms.has(entry.form))
              return []
            if (!Number.isFinite(entry.val)) return []
            const duration = durationDays(entry)
            if (periodType === 'annual' && duration !== null && duration < 250) return []
            if (periodType === 'interim' && duration !== null && (duration < 55 || duration > 300))
              return []
            return [{ unit, entry }]
          })
        })
        if (candidates.length === 0) continue
        const byEnd = new Map<string, { unit: string; entry: StructuredFactUnit }>()
        for (const candidate of candidates) {
          const current = byEnd.get(candidate.entry.end!)
          const currentDuration = current ? durationDays(current.entry) : null
          const candidateDuration = durationDays(candidate.entry)
          const preferShorterInterim =
            periodType === 'interim' &&
            candidateDuration !== null &&
            (currentDuration === null || candidateDuration < currentDuration)
          const sameDuration = candidateDuration === currentDuration
          if (
            !current ||
            preferShorterInterim ||
            (sameDuration && candidate.entry.filed! > current.entry.filed!)
          ) {
            byEnd.set(candidate.entry.end!, candidate)
          }
        }
        for (const { unit, entry } of byEnd.values()) {
          periods.set(entry.end!, [
            ...(periods.get(entry.end!) ?? []).filter((item) => item.metric.id !== definition.id),
            { metric: makeMetric(definition, concept, unit, entry.val!), entry }
          ])
        }
        matchedConcept = true
        break
      }
      if (matchedConcept) break
    }
  }
  return periods
}

function metricValue(metrics: GlobalFinancialMetric[], id: GlobalFinancialMetricId): number | null {
  return metrics.find((metric) => metric.id === id)?.value ?? null
}

function addCalculatedMetrics(metrics: GlobalFinancialMetric[]): GlobalFinancialMetric[] {
  const next = [...metrics]
  const currency = metrics.find((metric) => metric.currency)?.currency
  const add = (metric: GlobalFinancialMetric) => {
    if (!next.some((item) => item.id === metric.id) && Number.isFinite(metric.value))
      next.push(metric)
  }
  const revenue = metricValue(next, 'revenue')
  const grossProfit = metricValue(next, 'grossProfit')
  const netIncome = metricValue(next, 'netIncome')
  const assets = metricValue(next, 'totalAssets')
  const liabilities = metricValue(next, 'totalLiabilities')
  const equity = metricValue(next, 'stockholdersEquity')
  const operatingCashFlow = metricValue(next, 'operatingCashFlow')
  const capitalExpenditure = metricValue(next, 'capitalExpenditure')
  if (operatingCashFlow !== null && capitalExpenditure !== null) {
    add({
      id: 'freeCashFlow',
      label: '自由现金流',
      value: operatingCashFlow - Math.abs(capitalExpenditure),
      unit: 'currency',
      currency,
      derivation: 'calculated'
    })
  }
  if (revenue) {
    if (grossProfit !== null)
      add({
        id: 'grossMargin',
        label: '毛利率',
        value: (grossProfit / revenue) * 100,
        unit: 'percent',
        derivation: 'calculated'
      })
    if (netIncome !== null)
      add({
        id: 'netMargin',
        label: '净利率',
        value: (netIncome / revenue) * 100,
        unit: 'percent',
        derivation: 'calculated'
      })
  }
  if (equity && netIncome !== null)
    add({
      id: 'roe',
      label: 'ROE',
      value: (netIncome / equity) * 100,
      unit: 'percent',
      derivation: 'calculated'
    })
  if (assets && liabilities !== null)
    add({
      id: 'debtAssetRatio',
      label: '资产负债率',
      value: (liabilities / assets) * 100,
      unit: 'percent',
      derivation: 'calculated'
    })
  return next
}

function buildPeriods(
  grouped: Map<string, SelectedFact[]>,
  periodType: 'annual' | 'interim',
  filingSources: FilingSource[]
): GlobalFinancialPeriod[] {
  const sourceByAccession = new Map(
    filingSources.map((source) => [source.accessionNumber, source.url])
  )
  return [...grouped.entries()]
    .flatMap(([periodEnd, selected]): GlobalFinancialPeriod[] => {
      if (selected.length === 0) return []
      const newest = [...selected].sort((left, right) =>
        right.entry.filed!.localeCompare(left.entry.filed!)
      )[0]
      const accessionNumber = newest.entry.accn ?? ''
      const fiscalYear =
        periodType === 'annual'
          ? Number(periodEnd.slice(0, 4))
          : (newest.entry.fy ?? Number(periodEnd.slice(0, 4)))
      const fiscalPeriod = newest.entry.fp ?? (periodType === 'annual' ? 'FY' : 'Interim')
      return [
        {
          id: `${periodType}:${periodEnd}`,
          periodType,
          fiscalYear,
          fiscalPeriod,
          periodStart: newest.entry.start,
          periodEnd,
          filedAt: newest.entry.filed!,
          formType: newest.entry.form!,
          sourceUrl: sourceByAccession.get(accessionNumber) ?? 'https://www.sec.gov/edgar/search/',
          metrics: addCalculatedMetrics(selected.map((item) => item.metric))
        }
      ]
    })
    .sort((left, right) => right.periodEnd.localeCompare(left.periodEnd))
}

function buildTtmPeriod(
  annual: GlobalFinancialPeriod[],
  interim: GlobalFinancialPeriod[]
): GlobalFinancialPeriod | null {
  const current = interim[0]
  if (!current) return null
  const currentEnd = new Date(`${current.periodEnd}T00:00:00Z`).getTime()
  const priorInterim = interim.find((period) => {
    const dayDifference = Math.round(
      (currentEnd - new Date(`${period.periodEnd}T00:00:00Z`).getTime()) / 86_400_000
    )
    return (
      period.fiscalPeriod === current.fiscalPeriod && dayDifference >= 330 && dayDifference <= 400
    )
  })
  const priorAnnual = annual.find((period) => period.periodEnd < current.periodEnd)
  if (!priorInterim || !priorAnnual) return null
  const metrics = priorAnnual.metrics.flatMap((annualMetric): GlobalFinancialMetric[] => {
    if (!ADDITIVE_METRICS.has(annualMetric.id)) return []
    const currentValue = metricValue(current.metrics, annualMetric.id)
    const priorValue = metricValue(priorInterim.metrics, annualMetric.id)
    if (currentValue === null || priorValue === null) return []
    return [
      {
        ...annualMetric,
        value: annualMetric.value + currentValue - priorValue,
        derivation: 'calculated'
      }
    ]
  })
  if (metrics.length === 0) return null
  const latestBalanceMetrics = current.metrics.filter((metric) =>
    [
      'totalAssets',
      'totalLiabilities',
      'stockholdersEquity',
      'cashAndEquivalents',
      'totalDebt'
    ].includes(metric.id)
  )
  return {
    id: `ttm:${current.periodEnd}`,
    periodType: 'ttm',
    fiscalYear: current.fiscalYear,
    fiscalPeriod: 'TTM',
    periodStart: priorInterim.periodEnd,
    periodEnd: current.periodEnd,
    filedAt: current.filedAt,
    formType: `${current.formType} TTM`,
    sourceUrl: current.sourceUrl,
    metrics: addCalculatedMetrics([...metrics, ...latestBalanceMetrics])
  }
}

export function buildStructuredFinancialPeriods(
  payload: StructuredCompanyFacts,
  filingSources: FilingSource[]
): GlobalFinancialPeriod[] {
  const annual = buildPeriods(
    collectFacts(payload, ANNUAL_FORMS, 'annual'),
    'annual',
    filingSources
  )
  const interim = buildPeriods(
    collectFacts(payload, INTERIM_FORMS, 'interim'),
    'interim',
    filingSources
  )
  const ttm = buildTtmPeriod(annual, interim)
  return [...(ttm ? [ttm] : []), ...interim.slice(0, 4), ...annual.slice(0, 5)]
}

const HKEX_METRICS: Array<{ id: GlobalFinancialMetricId; label: string; patterns: RegExp[] }> = [
  { id: 'revenue', label: '营业收入', patterns: [/^revenue(?:s)?\b/i, /^turnover\b/i] },
  { id: 'grossProfit', label: '毛利润', patterns: [/^gross profit\b/i] },
  {
    id: 'operatingIncome',
    label: '营业利润',
    patterns: [/^operating profit\b/i, /^profit from operations\b/i]
  },
  {
    id: 'netIncome',
    label: '净利润',
    patterns: [/^profit (?:for the year|for the period|attributable to)/i]
  },
  { id: 'totalAssets', label: '总资产', patterns: [/^total assets\b/i] },
  { id: 'totalLiabilities', label: '总负债', patterns: [/^total liabilities\b/i] },
  {
    id: 'stockholdersEquity',
    label: '股东权益',
    patterns: [/^total equity\b/i, /^equity attributable to/i]
  },
  {
    id: 'operatingCashFlow',
    label: '经营现金流',
    patterns: [/^net cash (?:generated from|from) operating activities/i]
  }
]

function hkexScale(text: string): { currency: string; multiplier: number } | null {
  const matched = text.match(
    /(?:in\s+)?(RMB|HKD|HK\$|USD|US\$|CNY|Renminbi)\s*(?:in\s+)?(thousand|million|billion)/i
  )
  if (!matched) return null
  const currencyName = matched[1].toUpperCase()
  const currency =
    currencyName === 'RMB' || currencyName === 'RENMINBI'
      ? 'CNY'
      : currencyName === 'HK$'
        ? 'HKD'
        : currencyName === 'US$'
          ? 'USD'
          : currencyName
  const multiplier =
    matched[2].toLowerCase() === 'billion'
      ? 1_000_000_000
      : matched[2].toLowerCase() === 'million'
        ? 1_000_000
        : 1_000
  return { currency, multiplier }
}

function rowValue(line: string): number | null {
  const values = [...line.matchAll(/\(?-?\d[\d,]*(?:\.\d+)?\)?/g)].map((match) => match[0])
  const selected = values.find(
    (value) => value.includes(',') || Number(value.replace(/[(),]/g, '')) >= 100
  )
  if (!selected) return null
  const negative = selected.startsWith('(')
  const value = Number(selected.replace(/[(),]/g, ''))
  return Number.isFinite(value) ? (negative ? -value : value) : null
}

export function extractHkexFinancialMetrics(text: string): {
  currency: string
  metrics: GlobalFinancialMetric[]
} | null {
  const scale = hkexScale(text)
  if (!scale) return null
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const metrics = HKEX_METRICS.flatMap((definition): GlobalFinancialMetric[] => {
    const line = lines.find((candidate) =>
      definition.patterns.some((pattern) => pattern.test(candidate))
    )
    const value = line ? rowValue(line) : null
    return value === null
      ? []
      : [
          {
            id: definition.id,
            label: definition.label,
            value: value * scale.multiplier,
            unit: 'currency',
            currency: scale.currency,
            derivation: 'reported'
          }
        ]
  })
  return metrics.length > 0
    ? { currency: scale.currency, metrics: addCalculatedMetrics(metrics) }
    : null
}
