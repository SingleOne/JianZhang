import type {
  FundamentalChangeItem,
  FundamentalChangeMetrics,
  FundamentalChangeReport,
  FundamentalChangeType,
  FundamentalCompany,
  FundamentalIndustryBenchmark,
  FundamentalPeerComparison,
  FundamentalPeerMetricComparison,
  FundamentalRuleChange,
  FundamentalSnapshot
} from '../shared/types'
export type { FundamentalPeerComparison, FundamentalPeerMetricComparison } from '../shared/types'
import { hasFinancialMineRisk } from './financial-mine-detector'

export type FundamentalRoeMetric = 'weighted' | 'deducted'
export type FundamentalCashFlowMode = 'cumulative' | 'latest'

export interface FundamentalScreeningCriteria {
  roeMetric: FundamentalRoeMetric
  roeThreshold: number
  cashFlowMode: FundamentalCashFlowMode
  debtIndustryPercentile: number
}

export interface FundamentalScreeningChecks {
  roe: boolean
  cash: boolean
  debt: boolean
}

export interface FundamentalScreeningEvaluation {
  company: FundamentalCompany
  industryBenchmark: FundamentalIndustryBenchmark | null
  eligibleOrganization: boolean
  roeValues: Array<number | null>
  minimumRoe: number | null
  cumulativeNetProfit: number | null
  cumulativeOperatingCashFlow: number | null
  cumulativeCashConversion: number | null
  latestNetProfit: number | null
  latestOperatingCashFlow: number | null
  latestCashConversion: number | null
  selectedCashConversion: number | null
  checks: FundamentalScreeningChecks
  passedRuleCount: number
  passed: boolean
}

export type FundamentalRuleAssessmentStatus = 'passed' | 'failed' | 'missing' | 'not-applicable'

export type FundamentalScreeningSummaryStatus =
  'passed' | 'review' | 'missing' | 'financial' | 'unavailable'

export interface FundamentalScreeningSummary {
  status: FundamentalScreeningSummaryStatus
  ruleStatuses: Record<keyof FundamentalScreeningChecks, FundamentalRuleAssessmentStatus>
  reviewReasons: string[]
  missingReasons: string[]
  reviewCount: number
}

export type FundamentalQualityTag =
  | 'strictFundamental'
  | 'cashSustained'
  | 'profitGrowth'
  | 'roeStable'
  | 'deductedSolid'
  | 'improving'

export interface FundamentalQualityMetrics {
  minimumDeductedRoe: number | null
  sustainedCashYears: number
  netProfitCagr: number | null
  roeRange: number | null
  deductedProfitRatio: number | null
  latestCashConversion: number | null
}

export interface FundamentalQualityProfile {
  tags: FundamentalQualityTag[]
  metrics: FundamentalQualityMetrics
}

export const FUNDAMENTAL_QUALITY_TAG_LABELS: Record<FundamentalQualityTag, string> = {
  strictFundamental: '严格基本面',
  cashSustained: '现金持续',
  profitGrowth: '利润成长',
  roeStable: 'ROE稳定',
  deductedSolid: '扣非扎实',
  improving: '改善观察'
}

export type FundamentalRiskTag =
  | 'cashDivergence'
  | 'highLeverageRoe'
  | 'deductedWeak'
  | 'profitCashDivergence'
  | 'roeDecline'
  | 'singleYearCashWeak'

export type FundamentalRiskSeverity = 'critical' | 'warning'

export interface FundamentalRiskMetrics {
  minimumWeightedRoe: number | null
  cumulativeCashConversion: number | null
  debtIndustryPercentile: number | null
  minimumDeductedRoe: number | null
  latestCashConversion: number | null
  roeDeclinePoints: number | null
  latestNetProfit: number | null
  latestOperatingCashFlow: number | null
}

export interface FundamentalRiskProfile {
  tags: FundamentalRiskTag[]
  severity: FundamentalRiskSeverity | null
  metrics: FundamentalRiskMetrics
}

export const FUNDAMENTAL_RISK_TAG_LABELS: Record<FundamentalRiskTag, string> = {
  cashDivergence: '现金背离',
  highLeverageRoe: '高杠杆ROE',
  deductedWeak: '扣非偏弱',
  profitCashDivergence: '利润现金背离',
  roeDecline: 'ROE下滑',
  singleYearCashWeak: '单年现金转弱'
}

export const FUNDAMENTAL_RISK_TAG_SEVERITY: Record<FundamentalRiskTag, FundamentalRiskSeverity> = {
  cashDivergence: 'critical',
  highLeverageRoe: 'warning',
  deductedWeak: 'warning',
  profitCashDivergence: 'critical',
  roeDecline: 'warning',
  singleYearCashWeak: 'warning'
}

export type FundamentalWatchlistFilter =
  'all' | 'passed' | 'review' | 'missing' | 'financial' | 'unavailable' | 'roe' | 'cash' | 'debt'

export type FundamentalDividendCategory = 'dual' | 'fundamental' | 'dividend' | 'unlabeled'

export type FundamentalDividendFilter = 'all' | FundamentalDividendCategory

export interface FundamentalDividendWatchlistItem {
  evaluation: FundamentalScreeningEvaluation | undefined
  hasDividendLabel: boolean
}

export interface FundamentalDividendWatchlistSummary {
  total: number
  dual: number
  fundamental: number
  dividend: number
  unlabeled: number
}

export interface FundamentalWatchlistSummary {
  total: number
  covered: number
  passed: number
  review: number
  missing: number
  financial: number
  unavailable: number
  roe: number
  cash: number
  debt: number
  risk: number
}

export const MIN_FUNDAMENTAL_PEER_SAMPLE_SIZE = 10

export const DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA: FundamentalScreeningCriteria = {
  roeMetric: 'weighted',
  roeThreshold: 15,
  cashFlowMode: 'cumulative',
  debtIndustryPercentile: 60
}

function sumAnnualField(
  company: FundamentalCompany,
  field: 'netProfit' | 'operatingCashFlow'
): number | null {
  const values = company.annualReports.map((report) => report[field])
  if (values.some((value) => value === null)) return null
  return (values as number[]).reduce((total, value) => total + value, 0)
}

function cashConversion(netProfit: number | null, operatingCashFlow: number | null): number | null {
  if (netProfit === null || operatingCashFlow === null || netProfit <= 0) return null
  return (operatingCashFlow / netProfit) * 100
}

function completeValues(values: Array<number | null>, expectedLength: number): number[] | null {
  return values.length === expectedLength && values.every((value) => value !== null)
    ? (values as number[])
    : null
}

export function evaluateFundamentalCompany(
  company: FundamentalCompany,
  industryBenchmark: FundamentalIndustryBenchmark | null,
  criteria: FundamentalScreeningCriteria
): FundamentalScreeningEvaluation {
  const roeValues = company.annualReports.map((report) =>
    criteria.roeMetric === 'weighted'
      ? report.weightedAverageRoe
      : report.deductedWeightedAverageRoe
  )
  const completeRoeValues = roeValues.filter((value): value is number => value !== null)
  const minimumRoe =
    completeRoeValues.length === roeValues.length && roeValues.length > 0
      ? Math.min(...completeRoeValues)
      : null
  const cumulativeNetProfit = sumAnnualField(company, 'netProfit')
  const cumulativeOperatingCashFlow = sumAnnualField(company, 'operatingCashFlow')
  const cumulativeCashConversion = cashConversion(cumulativeNetProfit, cumulativeOperatingCashFlow)
  const latestReport = company.annualReports.at(-1)
  const latestNetProfit = latestReport?.netProfit ?? null
  const latestOperatingCashFlow = latestReport?.operatingCashFlow ?? null
  const latestCashConversion = cashConversion(latestNetProfit, latestOperatingCashFlow)
  const selectedCashConversion =
    criteria.cashFlowMode === 'cumulative' ? cumulativeCashConversion : latestCashConversion
  const eligibleOrganization = company.organizationType === 'general'
  const checks = {
    roe:
      roeValues.length === 5 &&
      roeValues.every((value) => value !== null && value > criteria.roeThreshold),
    cash: selectedCashConversion !== null && selectedCashConversion > 100,
    debt:
      company.latestBalanceSheet.industryPercentile !== null &&
      company.latestBalanceSheet.industryPercentile < criteria.debtIndustryPercentile
  }
  const passedRuleCount = Object.values(checks).filter(Boolean).length

  return {
    company,
    industryBenchmark,
    eligibleOrganization,
    roeValues,
    minimumRoe,
    cumulativeNetProfit,
    cumulativeOperatingCashFlow,
    cumulativeCashConversion,
    latestNetProfit,
    latestOperatingCashFlow,
    latestCashConversion,
    selectedCashConversion,
    checks,
    passedRuleCount,
    passed: eligibleOrganization && passedRuleCount === 3
  }
}

export function evaluateFundamentalQuality(company: FundamentalCompany): FundamentalQualityProfile {
  const reports = company.annualReports
  const defaultEvaluation = evaluateFundamentalCompany(
    company,
    null,
    DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA
  )
  const deductedRoeValues = completeValues(
    reports.map((report) => report.deductedWeightedAverageRoe),
    5
  )
  const weightedRoeValues = completeValues(
    reports.map((report) => report.weightedAverageRoe),
    5
  )
  const netProfitValues = completeValues(
    reports.map((report) => report.netProfit),
    5
  )
  const parentProfitValues = completeValues(
    reports.map((report) => report.parentNetProfit),
    5
  )
  const deductedProfitValues = completeValues(
    reports.map((report) => report.deductedParentNetProfit),
    5
  )
  const minimumDeductedRoe = deductedRoeValues ? Math.min(...deductedRoeValues) : null
  const sustainedCashYears = reports.filter(
    (report) =>
      report.netProfit !== null &&
      report.operatingCashFlow !== null &&
      report.operatingCashFlow > report.netProfit
  ).length
  const netProfitCagr =
    netProfitValues && netProfitValues[0] > 0 && netProfitValues.at(-1)! > 0
      ? (Math.pow(netProfitValues.at(-1)! / netProfitValues[0], 1 / 4) - 1) * 100
      : null
  const roeRange = weightedRoeValues
    ? Math.max(...weightedRoeValues) - Math.min(...weightedRoeValues)
    : null
  const cumulativeParentProfit = parentProfitValues?.reduce((total, value) => total + value, 0)
  const cumulativeDeductedProfit = deductedProfitValues?.reduce((total, value) => total + value, 0)
  const deductedProfitRatio =
    cumulativeParentProfit !== undefined &&
    cumulativeDeductedProfit !== undefined &&
    cumulativeParentProfit > 0
      ? (cumulativeDeductedProfit / cumulativeParentProfit) * 100
      : null
  const latestReport = reports.at(-1)
  const latestCashConversion = cashConversion(
    latestReport?.netProfit ?? null,
    latestReport?.operatingCashFlow ?? null
  )
  const recentReports = reports.slice(-3)
  const recentRoe = completeValues(
    recentReports.map((report) => report.weightedAverageRoe),
    3
  )
  const recentProfit = completeValues(
    recentReports.map((report) => report.netProfit),
    3
  )
  const improving =
    recentRoe !== null &&
    recentProfit !== null &&
    recentRoe[0] < recentRoe[1] &&
    recentRoe[1] < recentRoe[2] &&
    recentProfit[0] < recentProfit[1] &&
    recentProfit[1] < recentProfit[2] &&
    latestCashConversion !== null &&
    latestCashConversion > 100

  if (company.organizationType !== 'general') {
    return {
      tags: [],
      metrics: {
        minimumDeductedRoe,
        sustainedCashYears,
        netProfitCagr,
        roeRange,
        deductedProfitRatio,
        latestCashConversion
      }
    }
  }

  const tags: FundamentalQualityTag[] = []
  if (defaultEvaluation.passed && minimumDeductedRoe !== null && minimumDeductedRoe > 15) {
    tags.push('strictFundamental')
  }
  if (defaultEvaluation.passed && reports.length === 5 && sustainedCashYears === 5) {
    tags.push('cashSustained')
  }
  if (defaultEvaluation.passed && netProfitCagr !== null && netProfitCagr > 10) {
    tags.push('profitGrowth')
  }
  if (defaultEvaluation.passed && roeRange !== null && roeRange < 8) {
    tags.push('roeStable')
  }
  if (defaultEvaluation.passed && deductedProfitRatio !== null && deductedProfitRatio > 90) {
    tags.push('deductedSolid')
  }
  if (improving) tags.push('improving')

  return {
    tags,
    metrics: {
      minimumDeductedRoe,
      sustainedCashYears,
      netProfitCagr,
      roeRange,
      deductedProfitRatio,
      latestCashConversion
    }
  }
}

export function evaluateFundamentalRisk(company: FundamentalCompany): FundamentalRiskProfile {
  const reports = company.annualReports
  const weightedRoe = completeValues(
    reports.map((report) => report.weightedAverageRoe),
    5
  )
  const deductedRoe = completeValues(
    reports.map((report) => report.deductedWeightedAverageRoe),
    5
  )
  const netProfits = completeValues(
    reports.map((report) => report.netProfit),
    5
  )
  const operatingCashFlows = completeValues(
    reports.map((report) => report.operatingCashFlow),
    5
  )
  const minimumWeightedRoe = weightedRoe ? Math.min(...weightedRoe) : null
  const minimumDeductedRoe = deductedRoe ? Math.min(...deductedRoe) : null
  const cumulativeNetProfit = netProfits?.reduce((total, value) => total + value, 0)
  const cumulativeOperatingCashFlow = operatingCashFlows?.reduce((total, value) => total + value, 0)
  const cumulativeCashConversion =
    cumulativeNetProfit !== undefined && cumulativeOperatingCashFlow !== undefined
      ? cashConversion(cumulativeNetProfit, cumulativeOperatingCashFlow)
      : null
  const latestReport = reports.at(-1)
  const latestNetProfit = latestReport?.netProfit ?? null
  const latestOperatingCashFlow = latestReport?.operatingCashFlow ?? null
  const latestCashConversion = cashConversion(latestNetProfit, latestOperatingCashFlow)
  const roeDeclinePoints = weightedRoe ? weightedRoe[0] - weightedRoe.at(-1)! : null
  const highRoe = weightedRoe !== null && weightedRoe.every((value) => value > 15)
  const recentNetProfits = completeValues(
    reports.slice(-3).map((report) => report.netProfit),
    3
  )
  const recentOperatingCashFlows = completeValues(
    reports.slice(-3).map((report) => report.operatingCashFlow),
    3
  )
  const profitCashDivergence =
    recentNetProfits !== null &&
    recentOperatingCashFlows !== null &&
    recentNetProfits.every((value) => value > 0) &&
    recentNetProfits[0] < recentNetProfits[1] &&
    recentNetProfits[1] < recentNetProfits[2] &&
    recentOperatingCashFlows[0] > recentOperatingCashFlows[1] &&
    recentOperatingCashFlows[1] > recentOperatingCashFlows[2] &&
    latestCashConversion !== null &&
    latestCashConversion < 100
  const tags: FundamentalRiskTag[] = []

  if (company.organizationType === 'general') {
    if (highRoe && cumulativeCashConversion !== null && cumulativeCashConversion < 80) {
      tags.push('cashDivergence')
    }
    if (
      highRoe &&
      company.latestBalanceSheet.industryPercentile !== null &&
      company.latestBalanceSheet.industryPercentile >= 80
    ) {
      tags.push('highLeverageRoe')
    }
    if (highRoe && deductedRoe !== null && deductedRoe.some((value) => value <= 15)) {
      tags.push('deductedWeak')
    }
    if (profitCashDivergence) tags.push('profitCashDivergence')
    if (highRoe && roeDeclinePoints !== null && roeDeclinePoints >= 5) {
      tags.push('roeDecline')
    }
    if (
      cumulativeCashConversion !== null &&
      cumulativeCashConversion > 100 &&
      latestCashConversion !== null &&
      latestCashConversion < 100
    ) {
      tags.push('singleYearCashWeak')
    }
  }

  return {
    tags,
    severity: tags.some((tag) => FUNDAMENTAL_RISK_TAG_SEVERITY[tag] === 'critical')
      ? 'critical'
      : tags.length > 0
        ? 'warning'
        : null,
    metrics: {
      minimumWeightedRoe,
      cumulativeCashConversion,
      debtIndustryPercentile: company.latestBalanceSheet.industryPercentile,
      minimumDeductedRoe,
      latestCashConversion,
      roeDeclinePoints,
      latestNetProfit,
      latestOperatingCashFlow
    }
  }
}

export function summarizeFundamentalScreening(
  evaluation: FundamentalScreeningEvaluation | undefined
): FundamentalScreeningSummary {
  if (!evaluation) {
    return {
      status: 'unavailable',
      ruleStatuses: {
        roe: 'missing',
        cash: 'missing',
        debt: 'missing'
      },
      reviewReasons: [],
      missingReasons: ['当前快照没有这只股票的基本面数据'],
      reviewCount: 0
    }
  }

  if (!evaluation.eligibleOrganization) {
    return {
      status: 'financial',
      ruleStatuses: {
        roe: 'not-applicable',
        cash: 'not-applicable',
        debt: 'not-applicable'
      },
      reviewReasons: [],
      missingReasons: [],
      reviewCount: 0
    }
  }

  const roeComplete =
    evaluation.roeValues.length === 5 && evaluation.roeValues.every((value) => value !== null)
  const cashComplete =
    evaluation.cumulativeNetProfit !== null && evaluation.cumulativeOperatingCashFlow !== null
  const debtComplete = evaluation.company.latestBalanceSheet.industryPercentile !== null
  const ruleStatuses: FundamentalScreeningSummary['ruleStatuses'] = {
    roe: roeComplete ? (evaluation.checks.roe ? 'passed' : 'failed') : 'missing',
    cash: cashComplete ? (evaluation.checks.cash ? 'passed' : 'failed') : 'missing',
    debt: debtComplete ? (evaluation.checks.debt ? 'passed' : 'failed') : 'missing'
  }
  const reviewReasons = [
    ...(ruleStatuses.roe === 'failed' ? ['ROE未达标'] : []),
    ...(ruleStatuses.cash === 'failed'
      ? [
          evaluation.cumulativeNetProfit !== null && evaluation.cumulativeNetProfit <= 0
            ? '五年累计净利润不为正'
            : '现金转化不足'
        ]
      : []),
    ...(ruleStatuses.debt === 'failed' ? ['杠杆待核'] : [])
  ]
  const missingReasons = [
    ...(ruleStatuses.roe === 'missing' ? ['ROE数据不足'] : []),
    ...(ruleStatuses.cash === 'missing' ? ['现金数据不足'] : []),
    ...(ruleStatuses.debt === 'missing' ? ['负债数据不足'] : [])
  ]

  return {
    status: evaluation.passed ? 'passed' : missingReasons.length > 0 ? 'missing' : 'review',
    ruleStatuses,
    reviewReasons,
    missingReasons,
    reviewCount: reviewReasons.length
  }
}

export function summarizeFundamentalWatchlist(
  evaluations: Array<FundamentalScreeningEvaluation | undefined>
): FundamentalWatchlistSummary {
  const result: FundamentalWatchlistSummary = {
    total: evaluations.length,
    covered: 0,
    passed: 0,
    review: 0,
    missing: 0,
    financial: 0,
    unavailable: 0,
    roe: 0,
    cash: 0,
    debt: 0,
    risk: 0
  }
  evaluations.forEach((evaluation) => {
    const summary = summarizeFundamentalScreening(evaluation)
    if (evaluation) result.covered += 1
    if (summary.status === 'passed') result.passed += 1
    if (summary.status === 'review') result.review += 1
    if (summary.status === 'missing') result.missing += 1
    if (summary.status === 'financial') result.financial += 1
    if (summary.status === 'unavailable') result.unavailable += 1
    if (summary.ruleStatuses.roe === 'failed') result.roe += 1
    if (summary.ruleStatuses.cash === 'failed') result.cash += 1
    if (summary.ruleStatuses.debt === 'failed') result.debt += 1
    if (hasFundamentalRisk(evaluation)) result.risk += 1
  })
  return result
}

export function matchesFundamentalWatchlistFilter(
  evaluation: FundamentalScreeningEvaluation | undefined,
  filter: FundamentalWatchlistFilter
): boolean {
  if (filter === 'all') return true
  const summary = summarizeFundamentalScreening(evaluation)
  if (filter === 'roe' || filter === 'cash' || filter === 'debt') {
    return summary.ruleStatuses[filter] === 'failed'
  }
  return summary.status === filter
}

export function hasFundamentalRisk(
  evaluation: FundamentalScreeningEvaluation | undefined
): boolean {
  return Boolean(
    evaluation &&
    (evaluateFundamentalRisk(evaluation.company).tags.length > 0 ||
      hasFinancialMineRisk(evaluation.company))
  )
}

export function classifyFundamentalDividendCategory(
  evaluation: FundamentalScreeningEvaluation | undefined,
  hasDividendLabel: boolean
): FundamentalDividendCategory {
  const hasFundamentalLabel = evaluation?.passed === true
  if (hasFundamentalLabel && hasDividendLabel) return 'dual'
  if (hasFundamentalLabel) return 'fundamental'
  if (hasDividendLabel) return 'dividend'
  return 'unlabeled'
}

export function summarizeFundamentalDividendWatchlist(
  items: FundamentalDividendWatchlistItem[]
): FundamentalDividendWatchlistSummary {
  const summary: FundamentalDividendWatchlistSummary = {
    total: items.length,
    dual: 0,
    fundamental: 0,
    dividend: 0,
    unlabeled: 0
  }
  for (const item of items) {
    summary[classifyFundamentalDividendCategory(item.evaluation, item.hasDividendLabel)] += 1
  }
  return summary
}

export function matchesFundamentalDividendFilter(
  item: FundamentalDividendWatchlistItem,
  filter: FundamentalDividendFilter
): boolean {
  return (
    filter === 'all' ||
    classifyFundamentalDividendCategory(item.evaluation, item.hasDividendLabel) === filter
  )
}

interface PeerMetricIndex {
  sampleSize: number
  positions: Map<number, { first: number; last: number }>
}

function createPeerMetricIndex(values: number[], direction: 'higher' | 'lower'): PeerMetricIndex {
  const sorted = [...values].sort((left, right) =>
    direction === 'higher' ? right - left : left - right
  )
  const positions = new Map<number, { first: number; last: number }>()
  sorted.forEach((value, index) => {
    const position = positions.get(value)
    if (position) position.last = index
    else positions.set(value, { first: index, last: index })
  })
  return { sampleSize: sorted.length, positions }
}

function createPeerMetricComparison(
  value: number | null,
  index: PeerMetricIndex
): FundamentalPeerMetricComparison {
  const position = value === null ? undefined : index.positions.get(value)
  if (!position || index.sampleSize < MIN_FUNDAMENTAL_PEER_SAMPLE_SIZE) {
    return {
      value,
      sampleSize: index.sampleSize,
      rank: null,
      topPercent: null,
      betterThanPercent: null
    }
  }

  const rank = position.first + 1
  const peerCount = index.sampleSize - 1
  return {
    value,
    sampleSize: index.sampleSize,
    rank,
    topPercent: Math.ceil((rank / index.sampleSize) * 100),
    betterThanPercent:
      peerCount > 0 ? Math.round(((index.sampleSize - position.last - 1) / peerCount) * 100) : 0
  }
}

export function createFundamentalPeerComparisonMap(
  evaluations: FundamentalScreeningEvaluation[]
): Map<string, FundamentalPeerComparison> {
  const evaluationsByIndustry = new Map<string, FundamentalScreeningEvaluation[]>()
  evaluations
    .filter((evaluation) => evaluation.eligibleOrganization)
    .forEach((evaluation) => {
      const rows = evaluationsByIndustry.get(evaluation.company.industryCode) ?? []
      rows.push(evaluation)
      evaluationsByIndustry.set(evaluation.company.industryCode, rows)
    })

  const comparisons = new Map<string, FundamentalPeerComparison>()
  evaluationsByIndustry.forEach((industryEvaluations) => {
    const roeIndex = createPeerMetricIndex(
      industryEvaluations
        .map((evaluation) => evaluation.minimumRoe)
        .filter((value): value is number => value !== null),
      'higher'
    )
    const cashIndex = createPeerMetricIndex(
      industryEvaluations
        .map((evaluation) => evaluation.cumulativeCashConversion)
        .filter((value): value is number => value !== null),
      'higher'
    )
    const debtIndex = createPeerMetricIndex(
      industryEvaluations
        .map((evaluation) => evaluation.company.latestBalanceSheet.debtAssetRatio)
        .filter((value): value is number => value !== null),
      'lower'
    )

    industryEvaluations.forEach((evaluation) => {
      comparisons.set(evaluation.company.code, {
        industryCode: evaluation.company.industryCode,
        industryName: evaluation.company.industryName,
        roe: createPeerMetricComparison(evaluation.minimumRoe, roeIndex),
        cash: createPeerMetricComparison(evaluation.cumulativeCashConversion, cashIndex),
        debt: createPeerMetricComparison(
          evaluation.company.latestBalanceSheet.debtAssetRatio,
          debtIndex
        )
      })
    })
  })
  return comparisons
}

export function screenFundamentalCompanies(
  snapshot: FundamentalSnapshot,
  criteria: FundamentalScreeningCriteria
): FundamentalScreeningEvaluation[] {
  const benchmarks = new Map(snapshot.industries.map((industry) => [industry.code, industry]))
  return snapshot.rows.map((company) =>
    evaluateFundamentalCompany(company, benchmarks.get(company.industryCode) ?? null, criteria)
  )
}

const FUNDAMENTAL_RULES = ['roe', 'cash', 'debt'] as const

function changeMetrics(evaluation: FundamentalScreeningEvaluation): FundamentalChangeMetrics {
  return {
    minimumRoe: evaluation.minimumRoe,
    cumulativeCashConversion: evaluation.cumulativeCashConversion,
    debtIndustryPercentile: evaluation.company.latestBalanceSheet.industryPercentile
  }
}

export function createFundamentalChangeReport(
  previous: FundamentalSnapshot,
  current: FundamentalSnapshot,
  generatedAt = new Date().toISOString()
): FundamentalChangeReport {
  const previousByCode = new Map(
    screenFundamentalCompanies(previous, DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA).map(
      (evaluation) => [evaluation.company.code, evaluation]
    )
  )
  const currentByCode = new Map(
    screenFundamentalCompanies(current, DEFAULT_FUNDAMENTAL_SCREENING_CRITERIA).map(
      (evaluation) => [evaluation.company.code, evaluation]
    )
  )
  const allCodes = new Set([...previousByCode.keys(), ...currentByCode.keys()])
  const rows: FundamentalChangeItem[] = []

  allCodes.forEach((code) => {
    const before = previousByCode.get(code)
    const after = currentByCode.get(code)
    if (!before && after) {
      rows.push({
        code,
        name: after.company.name,
        market: after.company.market,
        industryName: after.company.industryName,
        changeTypes: ['addedCoverage'],
        previousStatus: 'unavailable',
        currentStatus: summarizeFundamentalScreening(after).status,
        previousOrganizationType: null,
        currentOrganizationType: after.company.organizationType,
        previousMetrics: null,
        currentMetrics: changeMetrics(after),
        ruleChanges: []
      })
      return
    }
    if (before && !after) {
      rows.push({
        code,
        name: before.company.name,
        market: before.company.market,
        industryName: before.company.industryName,
        changeTypes: ['removedCoverage'],
        previousStatus: summarizeFundamentalScreening(before).status,
        currentStatus: 'unavailable',
        previousOrganizationType: before.company.organizationType,
        currentOrganizationType: null,
        previousMetrics: changeMetrics(before),
        currentMetrics: null,
        ruleChanges: []
      })
      return
    }
    if (!before || !after) return

    const previousSummary = summarizeFundamentalScreening(before)
    const currentSummary = summarizeFundamentalScreening(after)
    const ruleChanges: FundamentalRuleChange[] = FUNDAMENTAL_RULES.flatMap((rule) => {
      const previousStatus = previousSummary.ruleStatuses[rule]
      const currentStatus = currentSummary.ruleStatuses[rule]
      return previousStatus === currentStatus ? [] : [{ rule, previousStatus, currentStatus }]
    })
    const changeTypes: FundamentalChangeType[] = []
    if (previousSummary.status !== 'passed' && currentSummary.status === 'passed') {
      changeTypes.push('entered')
    }
    if (previousSummary.status === 'passed' && currentSummary.status !== 'passed') {
      changeTypes.push('exited')
    }
    if (ruleChanges.some((change) => change.currentStatus === 'failed')) {
      changeTypes.push('reviewAdded')
    }
    if (
      ruleChanges.some(
        (change) => change.previousStatus === 'failed' && change.currentStatus === 'passed'
      )
    ) {
      changeTypes.push('reviewResolved')
    }
    if (
      ruleChanges.some(
        (change) =>
          change.previousStatus === 'missing' &&
          (change.currentStatus === 'passed' || change.currentStatus === 'failed')
      )
    ) {
      changeTypes.push('dataCompleted')
    }
    if (
      ruleChanges.some(
        (change) =>
          (change.previousStatus === 'passed' || change.previousStatus === 'failed') &&
          change.currentStatus === 'missing'
      )
    ) {
      changeTypes.push('dataMissing')
    }
    if (before.company.organizationType !== after.company.organizationType) {
      changeTypes.push('organizationChanged')
    }
    if (changeTypes.length === 0) return

    rows.push({
      code,
      name: after.company.name,
      market: after.company.market,
      industryName: after.company.industryName,
      changeTypes,
      previousStatus: previousSummary.status,
      currentStatus: currentSummary.status,
      previousOrganizationType: before.company.organizationType,
      currentOrganizationType: after.company.organizationType,
      previousMetrics: changeMetrics(before),
      currentMetrics: changeMetrics(after),
      ruleChanges
    })
  })

  const priority = (item: FundamentalChangeItem): number => {
    if (item.changeTypes.includes('exited')) return 0
    if (item.changeTypes.includes('reviewAdded')) return 1
    if (item.changeTypes.includes('dataMissing')) return 2
    if (item.changeTypes.includes('entered')) return 3
    if (item.changeTypes.includes('reviewResolved')) return 4
    if (item.changeTypes.includes('dataCompleted')) return 5
    if (item.changeTypes.includes('organizationChanged')) return 6
    if (item.changeTypes.includes('addedCoverage')) return 7
    return 8
  }
  rows.sort(
    (left, right) => priority(left) - priority(right) || left.code.localeCompare(right.code)
  )

  return {
    schemaVersion: 1,
    previousSnapshotDate: previous.snapshotDate,
    currentSnapshotDate: current.snapshotDate,
    previousFiscalYears: previous.fiscalYears,
    currentFiscalYears: current.fiscalYears,
    generatedAt,
    summary: {
      enteredCount: rows.filter((item) => item.changeTypes.includes('entered')).length,
      exitedCount: rows.filter((item) => item.changeTypes.includes('exited')).length,
      reviewAddedCount: rows.filter((item) => item.changeTypes.includes('reviewAdded')).length,
      reviewResolvedCount: rows.filter((item) => item.changeTypes.includes('reviewResolved'))
        .length,
      dataChangedCount: rows.filter(
        (item) =>
          item.changeTypes.includes('dataCompleted') || item.changeTypes.includes('dataMissing')
      ).length,
      addedCoverageCount: rows.filter((item) => item.changeTypes.includes('addedCoverage')).length,
      removedCoverageCount: rows.filter((item) => item.changeTypes.includes('removedCoverage'))
        .length,
      organizationChangedCount: rows.filter((item) =>
        item.changeTypes.includes('organizationChanged')
      ).length
    },
    rows
  }
}
