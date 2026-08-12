import type { FundamentalCompany, FundamentalQuarterlyRiskReport } from '../shared/types'

export type FinancialMineLevel = 'high' | 'medium' | 'low' | 'insufficient' | 'notApplicable'

export type FinancialMineIndicatorId =
  'operatingCashFlow' | 'receivableRevenueDivergence' | 'inventoryTurnover' | 'goodwillRatio'

export type FinancialMineIndicatorStatus = 'critical' | 'warning' | 'passed' | 'missing'

export interface FinancialMineIndicator {
  id: FinancialMineIndicatorId
  status: FinancialMineIndicatorStatus
  score: number
  value: number | null
  message: string
}

export interface FinancialMineAssessment {
  level: FinancialMineLevel
  score: number
  reportDate: string | null
  noticeDate: string | null
  consecutiveNegativeCashFlowQuarters: number | null
  indicators: FinancialMineIndicator[]
}

export const FINANCIAL_MINE_LEVEL_LABELS: Record<FinancialMineLevel, string> = {
  high: '高风险',
  medium: '中等风险',
  low: '低风险',
  insufficient: '数据不足',
  notApplicable: '暂不适用'
}

function latestReport(company: FundamentalCompany): FundamentalQuarterlyRiskReport | null {
  return company.quarterlyRiskReports?.at(-1) ?? null
}

function countConsecutiveNegativeCashFlow(
  reports: readonly FundamentalQuarterlyRiskReport[]
): number | null {
  const latestValue = reports.at(-1)?.operatingCashFlowQuarter
  if (latestValue === null || latestValue === undefined) return null
  let count = 0
  for (let index = reports.length - 1; index >= 0; index -= 1) {
    const value = reports[index].operatingCashFlowQuarter
    if (value === null) break
    if (value >= 0) break
    count += 1
  }
  return count
}

function cashFlowIndicator(consecutiveNegativeQuarters: number | null): FinancialMineIndicator {
  if (consecutiveNegativeQuarters === null) {
    return {
      id: 'operatingCashFlow',
      status: 'missing',
      score: 0,
      value: null,
      message: '缺少最新单季度经营现金流'
    }
  }
  if (consecutiveNegativeQuarters >= 4) {
    return {
      id: 'operatingCashFlow',
      status: 'critical',
      score: 3,
      value: consecutiveNegativeQuarters,
      message: `经营现金流连续 ${consecutiveNegativeQuarters} 季为负`
    }
  }
  if (consecutiveNegativeQuarters >= 2) {
    return {
      id: 'operatingCashFlow',
      status: 'warning',
      score: 1,
      value: consecutiveNegativeQuarters,
      message: `经营现金流连续 ${consecutiveNegativeQuarters} 季为负`
    }
  }
  return {
    id: 'operatingCashFlow',
    status: 'passed',
    score: 0,
    value: consecutiveNegativeQuarters,
    message:
      consecutiveNegativeQuarters === 1
        ? '最新一季为负，尚未达到连续2季关注线'
        : '经营现金流未连续为负'
  }
}

function thresholdIndicator(
  id: Exclude<FinancialMineIndicatorId, 'operatingCashFlow'>,
  value: number | null,
  warningThreshold: number,
  criticalThreshold: number | null,
  message: (value: number) => string
): FinancialMineIndicator {
  if (value === null) {
    return { id, status: 'missing', score: 0, value: null, message: '缺少同口径对比数据' }
  }
  if (criticalThreshold !== null && value > criticalThreshold) {
    return { id, status: 'critical', score: 3, value, message: message(value) }
  }
  if (value > warningThreshold) {
    return { id, status: 'warning', score: 1, value, message: message(value) }
  }
  return { id, status: 'passed', score: 0, value, message: message(value) }
}

export function evaluateFinancialMine(company: FundamentalCompany): FinancialMineAssessment {
  if (company.organizationType !== 'general') {
    return {
      level: 'notApplicable',
      score: 0,
      reportDate: company.quarterlyRiskReports?.at(-1)?.reportDate ?? null,
      noticeDate: company.quarterlyRiskReports?.at(-1)?.noticeDate ?? null,
      consecutiveNegativeCashFlowQuarters: null,
      indicators: []
    }
  }

  const reports = company.quarterlyRiskReports ?? []
  const latest = latestReport(company)
  const consecutiveNegativeCashFlowQuarters = countConsecutiveNegativeCashFlow(reports)
  const indicators: FinancialMineIndicator[] = [
    cashFlowIndicator(consecutiveNegativeCashFlowQuarters),
    thresholdIndicator(
      'receivableRevenueDivergence',
      latest?.receivableRevenueDivergence ?? null,
      10,
      20,
      (value) => `应收账款与营收同比增速差 ${value.toFixed(1)} 个百分点`
    ),
    thresholdIndicator(
      'inventoryTurnover',
      latest?.inventoryDaysChangeYoY ?? null,
      30,
      null,
      (value) => `存货周转天数同比${value >= 0 ? '延长' : '缩短'} ${Math.abs(value).toFixed(1)}%`
    ),
    thresholdIndicator(
      'goodwillRatio',
      latest?.goodwillAssetRatio ?? null,
      30,
      null,
      (value) => `商誉占总资产 ${value.toFixed(1)}%`
    )
  ]
  const score = indicators.reduce((total, indicator) => total + indicator.score, 0)
  const hasCritical = indicators.some((indicator) => indicator.status === 'critical')
  const hasWarning = indicators.some((indicator) => indicator.status === 'warning')
  const hasMissing = indicators.some((indicator) => indicator.status === 'missing')

  return {
    level: hasCritical ? 'high' : hasWarning ? 'medium' : hasMissing ? 'insufficient' : 'low',
    score,
    reportDate: latest?.reportDate ?? null,
    noticeDate: latest?.noticeDate ?? null,
    consecutiveNegativeCashFlowQuarters,
    indicators
  }
}

export function hasFinancialMineRisk(company: FundamentalCompany): boolean {
  const level = evaluateFinancialMine(company).level
  return level === 'high' || level === 'medium'
}
