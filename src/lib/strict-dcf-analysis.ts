import type { FundamentalCompany, FundamentalFcffCoverage } from '../shared/types'
import type { ValuationProfileTag } from './fundamental-valuation'
import { usesOrdinaryCorporateInvestmentMetrics } from './valuation-analysis'

export const STRICT_DCF_FORECAST_YEARS = 5
export const STRICT_DCF_BASE_TERMINAL_GROWTH_RATE = 3
export const STRICT_DCF_RISK_FREE_RATE = 2
export const STRICT_DCF_MARKET_RISK_PREMIUM = 6
export const STRICT_DCF_ASSUMPTION_DATE = '2026-09-08'
export const STRICT_DCF_MODEL_VERSION = 'fcff-wacc-dcf-v1'

export type DcfScenarioName = 'conservative' | 'base' | 'optimistic'
export type StrictDcfConclusion =
  'below-model-range' | 'within-model-range' | 'above-model-range' | 'unavailable'
export type StrictDcfConfidence = 'high' | 'medium' | 'low' | 'unavailable'
export type StrictDcfUnavailableReason =
  'not-applicable' | 'fcff' | 'wacc' | 'net-debt' | 'share-count' | 'terminal-growth'

export interface WaccInputDetail {
  value: number | null
  source: string
  dataDate: string
}

export interface WaccAnalysis {
  available: boolean
  value: number | null
  costOfEquity: number
  preTaxCostOfDebt: number | null
  equityWeight: number | null
  debtWeight: number | null
  effectiveTaxRate: number | null
  inputs: {
    riskFreeRate: WaccInputDetail
    beta: WaccInputDetail
    marketRiskPremium: WaccInputDetail
    equityValue: WaccInputDetail
    debtValue: WaccInputDetail
    preTaxCostOfDebt: WaccInputDetail
    effectiveTaxRate: WaccInputDetail
  }
  unavailableReason: string | null
}

export interface StrictDcfScenarioResult {
  scenario: DcfScenarioName
  forecastGrowthRate: number
  discountRate: number
  terminalGrowthRate: number
  enterpriseValue: number
  equityValue: number
  fairValuePerShare: number
}

export interface StrictDcfAnalysis {
  modelVersion: typeof STRICT_DCF_MODEL_VERSION
  normalizedFcff: number
  normalizationYears: number
  historicalGrowthRate: number | null
  wacc: WaccAnalysis
  scenarios: StrictDcfScenarioResult[]
  rangeLow: number
  rangeHigh: number
  currentPrice: number | null
  conclusion: StrictDcfConclusion
  confidence: StrictDcfConfidence
  warnings: string[]
}

export type StrictDcfAnalysisResult =
  | { analysis: StrictDcfAnalysis; unavailableReason: null; wacc: WaccAnalysis }
  | { analysis: null; unavailableReason: StrictDcfUnavailableReason; wacc: WaccAnalysis | null }

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function betaAssumption(tags: readonly ValuationProfileTag[]): number {
  if (tags.includes('high-growth')) return 1.25
  if (tags.includes('cyclical')) return 1.2
  if (tags.includes('asset-heavy')) return 0.95
  if (tags.includes('stable-cash-flow')) return 0.85
  return 1
}

export function createWaccAnalysis(
  company: FundamentalCompany,
  tags: readonly ValuationProfileTag[]
): WaccAnalysis {
  const latest = company.annualReports.at(-1)?.fcffBreakdown
  const beta = betaAssumption(tags)
  const costOfEquity = STRICT_DCF_RISK_FREE_RATE + beta * STRICT_DCF_MARKET_RISK_PREMIUM
  const equityValue = company.valuation?.totalMarketValue ?? null
  const debtValue = latest?.interestBearingDebt ?? null
  const preTaxCostOfDebt = latest?.preTaxDebtCost ?? null
  const effectiveTaxRate = latest?.effectiveTaxRate ?? null
  const capital = equityValue !== null && debtValue !== null ? equityValue + debtValue : null
  const equityWeight = capital !== null && capital > 0 ? equityValue! / capital : null
  const debtWeight = capital !== null && capital > 0 ? debtValue! / capital : null
  const debtInputsAvailable =
    debtValue === 0 || (preTaxCostOfDebt !== null && effectiveTaxRate !== null)
  const value =
    equityWeight !== null && debtWeight !== null && debtInputsAvailable
      ? costOfEquity * equityWeight +
        (debtValue === 0 ? 0 : preTaxCostOfDebt! * (1 - effectiveTaxRate! / 100) * debtWeight)
      : null
  const reportDate = latest?.reportDate ?? company.latestBalanceSheet.reportDate
  const marketDate = company.valuation?.dataDate ?? reportDate

  return {
    available: value !== null,
    value,
    costOfEquity,
    preTaxCostOfDebt,
    equityWeight: equityWeight === null ? null : equityWeight * 100,
    debtWeight: debtWeight === null ? null : debtWeight * 100,
    effectiveTaxRate,
    inputs: {
      riskFreeRate: {
        value: STRICT_DCF_RISK_FREE_RATE,
        source: '模型市场参数假设 v1',
        dataDate: STRICT_DCF_ASSUMPTION_DATE
      },
      beta: {
        value: beta,
        source: '企业特征标签对应的 Beta 模型假设',
        dataDate: STRICT_DCF_ASSUMPTION_DATE
      },
      marketRiskPremium: {
        value: STRICT_DCF_MARKET_RISK_PREMIUM,
        source: '模型市场参数假设 v1',
        dataDate: STRICT_DCF_ASSUMPTION_DATE
      },
      equityValue: { value: equityValue, source: '东方财富估值分析总市值', dataDate: marketDate },
      debtValue: { value: debtValue, source: '东方财富详细资产负债表', dataDate: reportDate },
      preTaxCostOfDebt: {
        value: preTaxCostOfDebt,
        source: '利息费用 ÷ 平均有息债务',
        dataDate: reportDate
      },
      effectiveTaxRate: {
        value: effectiveTaxRate,
        source: '所得税费用 ÷ 利润总额',
        dataDate: reportDate
      }
    },
    unavailableReason:
      value !== null
        ? null
        : equityValue === null
          ? '缺少权益市值。'
          : debtValue === null
            ? '缺少有息债务。'
            : preTaxCostOfDebt === null
              ? '缺少有效的债务成本。'
              : effectiveTaxRate === null
                ? '缺少有效税率。'
                : '资本权重无法计算。'
  }
}

function historicalFcffGrowth(company: FundamentalCompany): number | null {
  const values = company.annualReports
    .map((report) => report.fcffBreakdown?.fcff)
    .filter((value): value is number => value !== null && value !== undefined)
  const first = values[0]
  const latest = values.at(-1)
  return values.length >= 2 && first > 0 && latest !== undefined && latest > 0
    ? (Math.pow(latest / first, 1 / (values.length - 1)) - 1) * 100
    : null
}

function calculateScenario(
  scenario: DcfScenarioName,
  normalizedFcff: number,
  growthRatePercent: number,
  discountRatePercent: number,
  terminalGrowthRatePercent: number,
  netDebt: number,
  sharesOutstanding: number
): StrictDcfScenarioResult | null {
  if (terminalGrowthRatePercent >= discountRatePercent) return null
  const growthRate = growthRatePercent / 100
  const discountRate = discountRatePercent / 100
  const terminalGrowthRate = terminalGrowthRatePercent / 100
  let forecastFcff = normalizedFcff
  let discountedFcff = 0
  for (let year = 1; year <= STRICT_DCF_FORECAST_YEARS; year += 1) {
    forecastFcff *= 1 + growthRate
    discountedFcff += forecastFcff / Math.pow(1 + discountRate, year)
  }
  const terminalValue =
    (forecastFcff * (1 + terminalGrowthRate)) / (discountRate - terminalGrowthRate)
  const enterpriseValue =
    discountedFcff + terminalValue / Math.pow(1 + discountRate, STRICT_DCF_FORECAST_YEARS)
  const equityValue = enterpriseValue - netDebt
  return {
    scenario,
    forecastGrowthRate: growthRatePercent,
    discountRate: discountRatePercent,
    terminalGrowthRate: terminalGrowthRatePercent,
    enterpriseValue,
    equityValue,
    fairValuePerShare: equityValue / sharesOutstanding
  }
}

export function createStrictDcfAnalysis(
  company: FundamentalCompany,
  currentPrice: number | null | undefined,
  tags: readonly ValuationProfileTag[],
  fcff: FundamentalFcffCoverage
): StrictDcfAnalysisResult {
  if (!usesOrdinaryCorporateInvestmentMetrics(company.organizationType)) {
    return { analysis: null, unavailableReason: 'not-applicable', wacc: null }
  }
  if (fcff.normalizedFcff === null || fcff.normalizedFcff <= 0) {
    return { analysis: null, unavailableReason: 'fcff', wacc: null }
  }

  const wacc = createWaccAnalysis(company, tags)
  if (wacc.value === null) return { analysis: null, unavailableReason: 'wacc', wacc }
  const netDebt = company.latestBalanceSheet.netDebt
  if (netDebt === null || netDebt === undefined) {
    return { analysis: null, unavailableReason: 'net-debt', wacc }
  }
  const marketValue = company.valuation?.totalMarketValue
  const closePrice = company.valuation?.closePrice
  if (!marketValue || !closePrice || marketValue <= 0 || closePrice <= 0) {
    return { analysis: null, unavailableReason: 'share-count', wacc }
  }

  const historicalGrowthRate = historicalFcffGrowth(company)
  const baseGrowthRate = clamp(historicalGrowthRate ?? 0, -10, 15)
  const sharesOutstanding = marketValue / closePrice
  const scenarioInputs = [
    [
      'conservative',
      baseGrowthRate - 3,
      wacc.value + 1.5,
      STRICT_DCF_BASE_TERMINAL_GROWTH_RATE - 0.5
    ],
    ['base', baseGrowthRate, wacc.value, STRICT_DCF_BASE_TERMINAL_GROWTH_RATE],
    ['optimistic', baseGrowthRate + 3, wacc.value - 1, STRICT_DCF_BASE_TERMINAL_GROWTH_RATE + 0.5]
  ] as const
  const scenarios = scenarioInputs
    .map(([scenario, growth, discount, terminal]) =>
      calculateScenario(
        scenario,
        fcff.normalizedFcff!,
        growth,
        discount,
        terminal,
        netDebt,
        sharesOutstanding
      )
    )
    .filter((scenario): scenario is StrictDcfScenarioResult => scenario !== null)
  if (scenarios.length !== 3) {
    return { analysis: null, unavailableReason: 'terminal-growth', wacc }
  }

  const values = scenarios.map((scenario) => scenario.fairValuePerShare)
  const rangeLow = Math.min(...values)
  const rangeHigh = Math.max(...values)
  const comparablePrice =
    currentPrice !== null && currentPrice !== undefined && currentPrice > 0 ? currentPrice : null
  const conclusion: StrictDcfConclusion =
    comparablePrice === null
      ? 'unavailable'
      : comparablePrice < rangeLow
        ? 'below-model-range'
        : comparablePrice > rangeHigh
          ? 'above-model-range'
          : 'within-model-range'
  const baseValue = scenarios.find((scenario) => scenario.scenario === 'base')!.fairValuePerShare
  const rangeWidth = baseValue > 0 ? (rangeHigh - rangeLow) / baseValue : Number.POSITIVE_INFINITY
  const confidence: StrictDcfConfidence =
    fcff.status === 'unstable-input' || rangeWidth > 0.8
      ? 'low'
      : tags.includes('cyclical') || tags.includes('high-growth') || rangeWidth > 0.45
        ? 'medium'
        : 'high'
  const warnings = [
    '无风险利率、市场风险溢价和 Beta 当前为透明模型假设，并非实时市场观测值。',
    ...(fcff.reason ? [fcff.reason] : []),
    ...(tags.includes('cyclical') ? ['周期企业采用五年平均仍可能未覆盖完整周期。'] : []),
    ...(rangeWidth > 0.8 ? ['三情景区间较宽，模型对假设高度敏感。'] : [])
  ]

  return {
    analysis: {
      modelVersion: STRICT_DCF_MODEL_VERSION,
      normalizedFcff: fcff.normalizedFcff,
      normalizationYears: fcff.normalizationYears,
      historicalGrowthRate,
      wacc,
      scenarios,
      rangeLow,
      rangeHigh,
      currentPrice: comparablePrice,
      conclusion,
      confidence,
      warnings
    },
    unavailableReason: null,
    wacc
  }
}
