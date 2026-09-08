import type {
  FundamentalCompany,
  FundamentalFcffCoverage,
  FundamentalOrganizationType
} from '../shared/types'
import { createDcfAnalysis, type DcfAnalysisResult } from './dcf-analysis'
import { createFcffAnalysis } from './fcff-analysis'
import {
  createFinancialValuationAnalysis,
  type FinancialValuationAnalysis
} from './financial-valuation'
import {
  STRICT_DCF_MODEL_VERSION,
  createStrictDcfAnalysis,
  type StrictDcfAnalysisResult
} from './strict-dcf-analysis'
import { usesOrdinaryCorporateInvestmentMetrics } from './valuation-analysis'

export type ValuationProfileTag =
  'stable-cash-flow' | 'asset-heavy' | 'cyclical' | 'high-growth' | 'cash-flow-volatile'

export type ValuationModelRole = 'primary' | 'secondary' | 'informational'
export type ValuationAvailability =
  'available' | 'not-applicable' | 'insufficient-data' | 'stale-data' | 'unstable-input'

export interface ValuationMetricGuidance {
  id: string
  label: string
  role: ValuationModelRole
  availability: ValuationAvailability
  note: string
}

export interface FundamentalValuationProfile {
  organizationType: FundamentalOrganizationType
  organizationLabel: string
  tags: ValuationProfileTag[]
  reasons: string[]
  primaryModel: string
  recommendedMetrics: string[]
  unavailableMetrics: string[]
  metricGuidance: ValuationMetricGuidance[]
  warnings: string[]
}

export interface FundamentalValuationSummary {
  profile: FundamentalValuationProfile
  fcff: FundamentalFcffCoverage
  strictDcf: StrictDcfAnalysisResult
  financialValuation: FinancialValuationAnalysis | null
  dcf: DcfAnalysisResult
  dataDate: string
  modelVersion: 'simplified-fcf-dcf-v1'
  fcffModelVersion: 'strict-fcff-v1'
  strictDcfModelVersion: typeof STRICT_DCF_MODEL_VERSION
}

export const VALUATION_PROFILE_TAG_LABELS: Record<ValuationProfileTag, string> = {
  'stable-cash-flow': '稳定现金流',
  'asset-heavy': '重资产',
  cyclical: '周期特征',
  'high-growth': '高增长',
  'cash-flow-volatile': '现金流波动'
}

const ORGANIZATION_LABELS: Record<FundamentalOrganizationType, string> = {
  general: '普通企业',
  bank: '银行',
  securities: '证券公司',
  insurance: '保险公司',
  other: '其他企业'
}

const CYCLICAL_INDUSTRY_KEYWORDS = [
  '煤炭',
  '钢铁',
  '有色',
  '化工',
  '石油',
  '航运',
  '造纸',
  '水泥',
  '玻璃',
  '养殖'
]
const ASSET_HEAVY_INDUSTRY_KEYWORDS = [
  '电力',
  '铁路',
  '公路',
  '机场',
  '港口',
  '航空',
  '房地产',
  '建筑',
  '钢铁',
  '煤炭',
  '水泥',
  '石化'
]

function includesIndustryKeyword(
  company: FundamentalCompany,
  keywords: readonly string[]
): boolean {
  const source = `${company.industryName} ${company.businessProfile?.industryCsrc ?? ''} ${company.businessProfile?.mainBusiness ?? ''}`
  return keywords.some((keyword) => source.includes(keyword))
}

function cashFlowProfile(company: FundamentalCompany): {
  tags: ValuationProfileTag[]
  reasons: string[]
  warnings: string[]
} {
  const strictValues = company.annualReports
    .map((report) => report.fcffBreakdown?.fcff)
    .filter((value): value is number => value !== null && value !== undefined)
  const usesStrictFcff = strictValues.length >= 5
  const values = usesStrictFcff
    ? strictValues
    : company.annualReports
        .map((report) => report.freeCashFlow)
        .filter((value): value is number => value !== null && value !== undefined)
  if (values.length < 5) {
    return {
      tags: [],
      reasons: [],
      warnings: ['自由现金流不足五个完整财年，现金流稳定性标签暂不判断。']
    }
  }

  const positiveYears = values.filter((value) => value > 0).length
  const mean = values.reduce((total, value) => total + value, 0) / values.length
  const deviation = Math.sqrt(
    values.reduce((total, value) => total + Math.pow(value - mean, 2), 0) / values.length
  )
  const coefficientOfVariation = mean > 0 ? deviation / mean : Number.POSITIVE_INFINITY
  if (positiveYears >= 4 && coefficientOfVariation <= 0.35) {
    return {
      tags: ['stable-cash-flow'],
      reasons: [
        `近五年${usesStrictFcff ? '严格 FCFF' : '简化自由现金流'}至少四年为正，且波动系数不高于 0.35。`
      ],
      warnings: []
    }
  }
  if (positiveYears <= 2 || coefficientOfVariation >= 0.6) {
    return {
      tags: ['cash-flow-volatile'],
      reasons: [
        `近五年${usesStrictFcff ? '严格 FCFF' : '简化自由现金流'}正值年份较少或波动系数不低于 0.60。`
      ],
      warnings: ['现金流波动较大，单点 DCF 结果应降低权重。']
    }
  }
  return {
    tags: [],
    reasons: [
      `近五年${usesStrictFcff ? '严格 FCFF' : '简化自由现金流'}未达到稳定或高波动标签阈值。`
    ],
    warnings: []
  }
}

function financialProfile(company: FundamentalCompany): FundamentalValuationProfile {
  const pbAvailability: ValuationAvailability =
    company.valuation?.priceBookRatio === null || company.valuation?.priceBookRatio === undefined
      ? 'insufficient-data'
      : 'available'
  const latestRoe = company.annualReports.at(-1)?.weightedAverageRoe
  const roeAvailability: ValuationAvailability =
    latestRoe === null || latestRoe === undefined ? 'insufficient-data' : 'available'
  const shared = {
    organizationType: company.organizationType,
    organizationLabel: ORGANIZATION_LABELS[company.organizationType],
    tags: [] as ValuationProfileTag[],
    reasons: ['法定组织类型优先决定估值框架。'],
    unavailableMetrics: ['普通企业 FCFF', '普通企业 DCF', 'PCF', '普通企业净负债'],
    warnings: ['金融企业专用数据尚未完整接入，当前只展示已有事实和应关注指标。']
  }
  if (company.organizationType === 'bank') {
    return {
      ...shared,
      primaryModel: 'PB−ROE 与资产质量框架',
      recommendedMetrics: ['PB', 'ROE', '净息差', '不良率', '拨备覆盖率', '资本充足率'],
      metricGuidance: [
        {
          id: 'pb',
          label: 'PB',
          role: 'primary',
          availability: pbAvailability,
          note: '结合 ROE 判断'
        },
        {
          id: 'roe',
          label: 'ROE',
          role: 'primary',
          availability: roeAvailability,
          note: '观察持续性'
        },
        {
          id: 'bank-special',
          label: '银行专用指标',
          role: 'primary',
          availability: 'insufficient-data',
          note: '净息差、不良率、拨备和资本充足率尚未接入'
        }
      ]
    }
  }
  if (company.organizationType === 'insurance') {
    return {
      ...shared,
      primaryModel: 'P/EV 与新业务价值框架',
      recommendedMetrics: ['P/EV', 'ROE', '新业务价值', '偿付能力', '综合成本率'],
      metricGuidance: [
        {
          id: 'pb',
          label: 'PB',
          role: 'secondary',
          availability: pbAvailability,
          note: '仅作交叉验证'
        },
        {
          id: 'roe',
          label: 'ROE',
          role: 'secondary',
          availability: roeAvailability,
          note: '观察持续性'
        },
        {
          id: 'insurance-special',
          label: '保险专用指标',
          role: 'primary',
          availability: 'insufficient-data',
          note: '内含价值、新业务价值和偿付能力尚未接入'
        }
      ]
    }
  }
  return {
    ...shared,
    primaryModel: 'PB−ROE、净资本与周期框架',
    recommendedMetrics: ['PB', 'ROE', '净资本', '杠杆', '业务收入结构'],
    metricGuidance: [
      {
        id: 'pb',
        label: 'PB',
        role: 'primary',
        availability: pbAvailability,
        note: '结合周期位置判断'
      },
      {
        id: 'roe',
        label: 'ROE',
        role: 'primary',
        availability: roeAvailability,
        note: '观察跨周期水平'
      },
      {
        id: 'securities-special',
        label: '证券专用指标',
        role: 'primary',
        availability: 'insufficient-data',
        note: '净资本、杠杆和业务结构尚未接入'
      }
    ]
  }
}

export function createFundamentalValuationProfile(
  company: FundamentalCompany
): FundamentalValuationProfile {
  if (!usesOrdinaryCorporateInvestmentMetrics(company.organizationType)) {
    return financialProfile(company)
  }

  const cashFlow = cashFlowProfile(company)
  const tags = [...cashFlow.tags]
  const reasons = [...cashFlow.reasons]
  if (includesIndustryKeyword(company, CYCLICAL_INDUSTRY_KEYWORDS)) {
    tags.push('cyclical')
    reasons.push('结构化行业或主营业务命中周期行业映射。')
  }
  if (includesIndustryKeyword(company, ASSET_HEAVY_INDUSTRY_KEYWORDS)) {
    tags.push('asset-heavy')
    reasons.push('结构化行业或主营业务命中重资产行业映射。')
  }

  return {
    organizationType: company.organizationType,
    organizationLabel: ORGANIZATION_LABELS[company.organizationType],
    tags: [...new Set(tags)],
    reasons,
    primaryModel: '简化现金流 DCF',
    recommendedMetrics: ['现金流 DCF', 'ROIC', '自由现金流', 'PE', 'PB', 'PCF'],
    unavailableMetrics: [],
    metricGuidance: [
      {
        id: 'dcf',
        label: '简化现金流 DCF',
        role: 'primary',
        availability: 'available',
        note: '阶段 A 沿用现有经营现金流减资本开支口径'
      },
      {
        id: 'roic',
        label: 'ROIC',
        role: 'primary',
        availability: 'available',
        note: '观察资本回报'
      },
      {
        id: 'pe',
        label: 'PE',
        role: 'secondary',
        availability: 'available',
        note: '历史与同行验证'
      },
      {
        id: 'pb',
        label: 'PB',
        role: 'secondary',
        availability: 'available',
        note: '历史与同行验证'
      },
      {
        id: 'pcf',
        label: 'PCF',
        role: 'secondary',
        availability: 'available',
        note: '现金质量验证'
      }
    ],
    warnings: [
      ...cashFlow.warnings,
      ...(tags.includes('cyclical') ? ['周期企业不应直接外推单年景气水平。'] : []),
      ...(tags.includes('asset-heavy') ? ['重资产企业需区分维持性与扩张性资本开支。'] : [])
    ]
  }
}

export function createFundamentalValuationSummary(
  company: FundamentalCompany,
  currentPrice: number | null | undefined
): FundamentalValuationSummary {
  const profile = createFundamentalValuationProfile(company)
  const fcff = createFcffAnalysis(company, profile.tags.includes('cyclical') ? 5 : 3)
  const dcf = createDcfAnalysis(company, currentPrice)
  const strictDcf = createStrictDcfAnalysis(company, currentPrice, profile.tags, fcff)
  const financialValuation = createFinancialValuationAnalysis(company)
  const dcfAvailability: ValuationAvailability = dcf.analysis
    ? 'available'
    : dcf.unavailableReason === 'not-applicable'
      ? 'not-applicable'
      : 'insufficient-data'
  return {
    profile: {
      ...profile,
      primaryModel: strictDcf.analysis ? 'FCFF−WACC 三情景 DCF' : profile.primaryModel,
      metricGuidance: [
        ...(usesOrdinaryCorporateInvestmentMetrics(company.organizationType)
          ? [
              {
                id: 'fcff',
                label: '严格 FCFF',
                role: 'informational' as const,
                availability:
                  fcff.status === 'not-applicable'
                    ? ('not-applicable' as const)
                    : fcff.status === 'insufficient-data'
                      ? ('insufficient-data' as const)
                      : fcff.status === 'unstable-input'
                        ? ('unstable-input' as const)
                        : ('available' as const),
                note:
                  fcff.reason ??
                  `以最近 ${fcff.normalizationYears} 年有效 FCFF 正常化；阶段 B 仅作为待 WACC 输入`
              }
            ]
          : []),
        ...profile.metricGuidance.map((metric) =>
          metric.id === 'dcf'
            ? {
                ...metric,
                role: strictDcf.analysis ? ('secondary' as const) : metric.role,
                availability: dcfAvailability,
                note: strictDcf.analysis ? '固定 10% 折现率的旧快照兼容结果' : metric.note
              }
            : metric
        ),
        ...(usesOrdinaryCorporateInvestmentMetrics(company.organizationType)
          ? [
              {
                id: 'strict-dcf',
                label: 'FCFF−WACC 三情景 DCF',
                role: 'primary' as const,
                availability: strictDcf.analysis
                  ? ('available' as const)
                  : strictDcf.unavailableReason === 'not-applicable'
                    ? ('not-applicable' as const)
                    : ('insufficient-data' as const),
                note: strictDcf.analysis
                  ? `可信度：${strictDcf.analysis.confidence}`
                  : (strictDcf.wacc?.unavailableReason ?? '严格 FCFF 或折现参数不完整')
              }
            ]
          : [])
      ],
      warnings: [
        ...profile.warnings,
        ...(fcff.reason ? [fcff.reason] : []),
        ...(strictDcf.analysis?.warnings ?? [])
      ]
    },
    fcff,
    strictDcf,
    financialValuation,
    dcf,
    dataDate: company.annualReports.at(-1)?.reportDate ?? company.latestBalanceSheet.reportDate,
    modelVersion: 'simplified-fcf-dcf-v1',
    fcffModelVersion: 'strict-fcff-v1',
    strictDcfModelVersion: STRICT_DCF_MODEL_VERSION
  }
}
