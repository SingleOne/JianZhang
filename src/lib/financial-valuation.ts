import type { FundamentalCompany, FundamentalOrganizationType } from '../shared/types'

export type FinancialOrganizationType = Extract<
  FundamentalOrganizationType,
  'bank' | 'insurance' | 'securities'
>

export interface FinancialValuationFact {
  id: 'pb' | 'pe' | 'roe'
  label: string
  value: number | null
  unit: 'multiple' | 'percent'
  role: 'primary' | 'secondary' | 'informational'
  dataDate: string
  source: string
}

export interface FinancialRequiredMetric {
  id: string
  label: string
  status: 'not-integrated'
  reason: string
}

export interface FinancialValuationAnalysis {
  organizationType: FinancialOrganizationType
  framework: string
  facts: FinancialValuationFact[]
  requiredMetrics: FinancialRequiredMetric[]
  conclusion: 'insufficient-data'
  confidence: 'unavailable'
  warnings: string[]
}

const REQUIRED_METRICS: Record<FinancialOrganizationType, Array<{ id: string; label: string }>> = {
  bank: [
    { id: 'net-interest-margin', label: '净息差' },
    { id: 'non-performing-loan-ratio', label: '不良率' },
    { id: 'provision-coverage', label: '拨备覆盖率' },
    { id: 'capital-adequacy', label: '资本充足率' },
    { id: 'cost-income-ratio', label: '成本收入比' }
  ],
  insurance: [
    { id: 'embedded-value', label: '内含价值' },
    { id: 'new-business-value', label: '新业务价值' },
    { id: 'solvency-ratio', label: '偿付能力充足率' },
    { id: 'combined-ratio', label: '综合成本率' },
    { id: 'investment-yield', label: '投资收益率' }
  ],
  securities: [
    { id: 'net-capital', label: '净资本' },
    { id: 'risk-coverage', label: '风险覆盖率' },
    { id: 'leverage', label: '杠杆水平' },
    { id: 'brokerage-income', label: '经纪收入结构' },
    { id: 'investment-banking-income', label: '投行收入结构' },
    { id: 'proprietary-income', label: '自营收入结构' }
  ]
}

const FRAMEWORKS: Record<FinancialOrganizationType, string> = {
  bank: 'PB−ROE 与资产质量框架',
  insurance: 'P/EV 与新业务价值框架',
  securities: 'PB−ROE、净资本与周期框架'
}

export function createFinancialValuationAnalysis(
  company: FundamentalCompany
): FinancialValuationAnalysis | null {
  if (
    company.organizationType !== 'bank' &&
    company.organizationType !== 'insurance' &&
    company.organizationType !== 'securities'
  ) {
    return null
  }

  const type = company.organizationType
  const latestReport = company.annualReports.at(-1)
  const valuationDate = company.valuation?.dataDate ?? company.latestBalanceSheet.reportDate
  return {
    organizationType: type,
    framework: FRAMEWORKS[type],
    facts: [
      {
        id: 'pb',
        label: '市净率 PB',
        value: company.valuation?.priceBookRatio ?? null,
        unit: 'multiple',
        role: type === 'insurance' ? 'secondary' : 'primary',
        dataDate: valuationDate,
        source: '东方财富估值分析'
      },
      {
        id: 'roe',
        label: '加权 ROE',
        value: latestReport?.weightedAverageRoe ?? null,
        unit: 'percent',
        role: type === 'insurance' ? 'secondary' : 'primary',
        dataDate: latestReport?.reportDate ?? company.latestBalanceSheet.reportDate,
        source: '东方财富主要财务指标'
      },
      {
        id: 'pe',
        label: '市盈率 PE TTM',
        value: company.valuation?.priceEarningsRatioTtm ?? null,
        unit: 'multiple',
        role: 'informational',
        dataDate: valuationDate,
        source: '东方财富估值分析'
      }
    ],
    requiredMetrics: REQUIRED_METRICS[type].map((metric) => ({
      ...metric,
      status: 'not-integrated',
      reason: '当前基本面快照尚未接入该行业专用数据。'
    })),
    conclusion: 'insufficient-data',
    confidence: 'unavailable',
    warnings: [
      '当前仅展示 PB、ROE、PE 等已有事实，专用指标未完整接入前不输出完整金融估值结论。',
      type === 'securities'
        ? '证券公司盈利周期较强，单年 PE 只作信息展示。'
        : type === 'bank'
          ? '银行普通企业 FCFF、PCF 和净负债口径不适用。'
          : '保险公司普通企业 FCFF−DCF 不适用，且不能用 PB 替代内含价值。'
    ]
  }
}
