import type { FundamentalScreeningEvaluation } from './fundamental-screening'
import {
  classifyFundamentalDividendCategory,
  evaluateFundamentalRisk,
  type FundamentalDividendCategory,
  type FundamentalRiskTag
} from './fundamental-screening'

export type PortfolioValueCategory = FundamentalDividendCategory
export type PortfolioRiskCategory = 'critical' | 'warning' | 'clear' | 'unassessed'

export interface PortfolioQualityInput {
  quoteId: string
  code: string
  name: string
  industryName: string
  marketValue: number | null
  costValue: number
  fundamentalEvaluation?: FundamentalScreeningEvaluation
  hasDividendLabel: boolean
}

export interface PortfolioQualityBucket {
  count: number
  pricedCount: number
  marketValue: number
  percent: number | null
}

export interface PortfolioQualityHolding {
  quoteId: string
  code: string
  name: string
  industryName: string
  marketValue: number | null
  costValue: number
  weight: number | null
  valueCategory: PortfolioValueCategory
  riskCategory: PortfolioRiskCategory
  riskTags: FundamentalRiskTag[]
}

export interface PortfolioIndustrySummary {
  name: string
  count: number
  pricedCount: number
  marketValue: number
  percent: number | null
  valueBuckets: Record<PortfolioValueCategory, PortfolioQualityBucket>
  riskBuckets: Record<PortfolioRiskCategory, PortfolioQualityBucket>
}

export interface PortfolioQualitySummary {
  positionCount: number
  pricedPositionCount: number
  unpricedPositionCount: number
  totalMarketValue: number | null
  unpricedCostValue: number
  valueBuckets: Record<PortfolioValueCategory, PortfolioQualityBucket>
  riskBuckets: Record<PortfolioRiskCategory, PortfolioQualityBucket>
  riskTagBuckets: Record<FundamentalRiskTag, PortfolioQualityBucket>
  industries: PortfolioIndustrySummary[]
  holdings: PortfolioQualityHolding[]
}

const VALUE_CATEGORIES: PortfolioValueCategory[] = [
  'dual',
  'fundamental',
  'dividend',
  'unlabeled'
]

const RISK_CATEGORIES: PortfolioRiskCategory[] = [
  'critical',
  'warning',
  'clear',
  'unassessed'
]

export const PORTFOLIO_RISK_TAGS: FundamentalRiskTag[] = [
  'cashDivergence',
  'profitCashDivergence',
  'highLeverageRoe',
  'deductedWeak',
  'roeDecline',
  'singleYearCashWeak'
]

function emptyBucket(): PortfolioQualityBucket {
  return { count: 0, pricedCount: 0, marketValue: 0, percent: null }
}

function createBuckets<T extends string>(categories: T[]): Record<T, PortfolioQualityBucket> {
  return Object.fromEntries(categories.map((category) => [category, emptyBucket()])) as Record<
    T,
    PortfolioQualityBucket
  >
}

function valueCategory(input: PortfolioQualityInput): PortfolioValueCategory {
  return classifyFundamentalDividendCategory(
    input.fundamentalEvaluation,
    input.hasDividendLabel
  )
}

function hasCompleteRiskInputs(evaluation: FundamentalScreeningEvaluation): boolean {
  const { company } = evaluation
  return company.organizationType === 'general'
    && company.annualReports.length === 5
    && company.annualReports.every((report) => (
      report.weightedAverageRoe !== null
      && report.deductedWeightedAverageRoe !== null
      && report.netProfit !== null
      && report.operatingCashFlow !== null
    ))
    && company.latestBalanceSheet.industryPercentile !== null
}

function riskProfile(input: PortfolioQualityInput): {
  category: PortfolioRiskCategory
  tags: FundamentalRiskTag[]
} {
  const evaluation = input.fundamentalEvaluation
  if (!evaluation || evaluation.company.organizationType !== 'general') {
    return { category: 'unassessed', tags: [] }
  }
  const profile = evaluateFundamentalRisk(evaluation.company)
  if (profile.severity) return { category: profile.severity, tags: profile.tags }
  return {
    category: hasCompleteRiskInputs(evaluation) ? 'clear' : 'unassessed',
    tags: []
  }
}

function applyPercentages<T extends string>(
  buckets: Record<T, PortfolioQualityBucket>,
  categories: T[],
  totalMarketValue: number
): void {
  for (const category of categories) {
    buckets[category].percent = totalMarketValue > 0
      ? buckets[category].marketValue / totalMarketValue * 100
      : null
  }
}

export function calculatePortfolioQualitySummary(
  inputs: PortfolioQualityInput[]
): PortfolioQualitySummary {
  const valueBuckets = createBuckets(VALUE_CATEGORIES)
  const riskBuckets = createBuckets(RISK_CATEGORIES)
  const riskTagBuckets = createBuckets(PORTFOLIO_RISK_TAGS)
  const industriesByName = new Map<string, PortfolioIndustrySummary>()
  const holdings: PortfolioQualityHolding[] = []
  let totalMarketValue = 0
  let pricedPositionCount = 0
  let unpricedCostValue = 0

  for (const input of inputs) {
    const value = valueCategory(input)
    const risk = riskProfile(input)
    const priced = input.marketValue !== null
    const industry = industriesByName.get(input.industryName) ?? {
      name: input.industryName,
      count: 0,
      pricedCount: 0,
      marketValue: 0,
      percent: null,
      valueBuckets: createBuckets(VALUE_CATEGORIES),
      riskBuckets: createBuckets(RISK_CATEGORIES)
    }
    industriesByName.set(input.industryName, industry)

    valueBuckets[value].count += 1
    riskBuckets[risk.category].count += 1
    industry.count += 1
    industry.valueBuckets[value].count += 1
    industry.riskBuckets[risk.category].count += 1
    for (const tag of risk.tags) riskTagBuckets[tag].count += 1
    if (priced) {
      pricedPositionCount += 1
      totalMarketValue += input.marketValue!
      valueBuckets[value].pricedCount += 1
      valueBuckets[value].marketValue += input.marketValue!
      riskBuckets[risk.category].pricedCount += 1
      riskBuckets[risk.category].marketValue += input.marketValue!
      industry.pricedCount += 1
      industry.marketValue += input.marketValue!
      industry.valueBuckets[value].pricedCount += 1
      industry.valueBuckets[value].marketValue += input.marketValue!
      industry.riskBuckets[risk.category].pricedCount += 1
      industry.riskBuckets[risk.category].marketValue += input.marketValue!
      for (const tag of risk.tags) {
        riskTagBuckets[tag].pricedCount += 1
        riskTagBuckets[tag].marketValue += input.marketValue!
      }
    } else {
      unpricedCostValue += input.costValue
    }

    holdings.push({
      quoteId: input.quoteId,
      code: input.code,
      name: input.name,
      industryName: input.industryName,
      marketValue: input.marketValue,
      costValue: input.costValue,
      weight: null,
      valueCategory: value,
      riskCategory: risk.category,
      riskTags: risk.tags
    })
  }

  applyPercentages(valueBuckets, VALUE_CATEGORIES, totalMarketValue)
  applyPercentages(riskBuckets, RISK_CATEGORIES, totalMarketValue)
  applyPercentages(riskTagBuckets, PORTFOLIO_RISK_TAGS, totalMarketValue)
  const industries = [...industriesByName.values()]
  for (const industry of industries) {
    industry.percent = totalMarketValue > 0
      ? industry.marketValue / totalMarketValue * 100
      : null
    applyPercentages(industry.valueBuckets, VALUE_CATEGORIES, industry.marketValue)
    applyPercentages(industry.riskBuckets, RISK_CATEGORIES, industry.marketValue)
  }
  industries.sort((left, right) => (
    right.marketValue - left.marketValue || left.name.localeCompare(right.name, 'zh-CN')
  ))
  for (const holding of holdings) {
    holding.weight = holding.marketValue !== null && totalMarketValue > 0
      ? holding.marketValue / totalMarketValue * 100
      : null
  }
  holdings.sort((left, right) => {
    if (left.marketValue === null) return right.marketValue === null
      ? left.name.localeCompare(right.name, 'zh-CN')
      : 1
    if (right.marketValue === null) return -1
    return right.marketValue - left.marketValue
  })

  return {
    positionCount: inputs.length,
    pricedPositionCount,
    unpricedPositionCount: inputs.length - pricedPositionCount,
    totalMarketValue: pricedPositionCount > 0 ? totalMarketValue : null,
    unpricedCostValue,
    valueBuckets,
    riskBuckets,
    riskTagBuckets,
    industries,
    holdings
  }
}
