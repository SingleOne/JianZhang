import type { FundamentalCompany, FundamentalFcffCoverage } from '../shared/types'
import { usesOrdinaryCorporateInvestmentMetrics } from './valuation-analysis'

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

export function createFcffAnalysis(
  company: FundamentalCompany,
  normalizationYears: 3 | 5 = 3
): FundamentalFcffCoverage {
  if (!usesOrdinaryCorporateInvestmentMetrics(company.organizationType)) {
    return {
      status: 'not-applicable',
      totalYears: company.annualReports.length,
      validYears: 0,
      positiveYears: 0,
      coefficientOfVariation: null,
      normalizedFcff: null,
      normalizationYears,
      reason: '金融企业不适用普通企业 FCFF 口径。'
    }
  }

  const values = company.annualReports
    .map((report) => report.fcffBreakdown?.fcff)
    .filter((value): value is number => value !== null && value !== undefined)
  const recent = company.annualReports
    .slice(-normalizationYears)
    .map((report) => report.fcffBreakdown?.fcff)
  if (recent.length < normalizationYears || recent.some((value) => value == null)) {
    return {
      status: 'insufficient-data',
      totalYears: company.annualReports.length,
      validYears: values.length,
      positiveYears: values.filter((value) => value > 0).length,
      coefficientOfVariation: null,
      normalizedFcff: null,
      normalizationYears,
      reason: `最近 ${normalizationYears} 年严格 FCFF 不完整。`
    }
  }

  const normalizedFcff = average(recent as number[])
  const mean = average(values)
  const coefficientOfVariation =
    mean > 0
      ? Math.sqrt(
          values.reduce((total, value) => total + Math.pow(value - mean, 2), 0) / values.length
        ) / mean
      : null
  if (normalizedFcff <= 0) {
    return {
      status: 'unstable-input',
      totalYears: company.annualReports.length,
      validYears: values.length,
      positiveYears: values.filter((value) => value > 0).length,
      coefficientOfVariation,
      normalizedFcff,
      normalizationYears,
      reason: `最近 ${normalizationYears} 年平均严格 FCFF 不为正。`
    }
  }

  return {
    status:
      coefficientOfVariation !== null && coefficientOfVariation >= 0.6
        ? 'unstable-input'
        : 'available',
    totalYears: company.annualReports.length,
    validYears: values.length,
    positiveYears: values.filter((value) => value > 0).length,
    coefficientOfVariation,
    normalizedFcff,
    normalizationYears,
    reason:
      coefficientOfVariation !== null && coefficientOfVariation >= 0.6
        ? '严格 FCFF 波动系数不低于 0.60，模型输入稳定性较低。'
        : null
  }
}
