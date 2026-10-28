import type { AiLongTermInterpretation } from './types'

// Shared by the prompt and result normalization so new and saved analyses use the same terms.
export const LONG_TERM_FIELD_LABELS: Record<string, string> = {
  fundamental: '基本面数据',
  annualReports: '年度财报',
  latestBalanceSheet: '最新资产负债表',
  screening: '基本面筛选结果',
  quality: '财务质量指标',
  risk: '财务风险指标',
  financialMine: '财务风险规则检查',
  peerComparison: '同行业比较',
  dividendFinancing: '分红融资数据',
  companyReportSummaries: '财报 AI 二次总结',
  valuation: '估值指标',
  priceStrength: '历史价格统计',
  company: '公司财务数据',
  item: '明细',
  metrics: '指标',
  available: '数据是否可用',
  companyCovered: '是否覆盖该公司',
  snapshotDate: '快照日期',
  generatedAt: '生成时间',
  fiscalYears: '财务年度',
  staleReason: '数据滞后原因',
  ordinaryCorporateMetricsApplicable: '普通企业指标是否适用',
  ordinaryCorporateMetricsReason: '普通企业指标适用说明',
  weightedAverageRoe: '加权平均净资产收益率（ROE）',
  deductedWeightedAverageRoe: '扣非加权平均净资产收益率',
  roic: '投入资本回报率（ROIC）',
  netProfit: '净利润',
  parentNetProfit: '归母净利润',
  deductedParentNetProfit: '扣非归母净利润',
  operatingCashFlow: '经营活动现金流净额',
  capitalExpenditure: '资本开支',
  freeCashFlow: '自由现金流',
  fcff: '企业自由现金流（FCFF）',
  fcffBreakdown: '企业自由现金流计算明细',
  debtAssetRatio: '资产负债率',
  industryDebtPercentile: '资产负债率行业分位',
  industryDebtP60: '行业资产负债率第60百分位',
  monetaryFunds: '货币资金',
  interestBearingDebt: '有息负债',
  netDebt: '净负债',
  minimumWeightedRoe: '五年最低加权平均净资产收益率',
  minimumDeductedRoe: '五年最低扣非净资产收益率',
  cumulativeCashConversion: '五年累计经营现金流与净利润之比',
  latestCashConversion: '最近年度经营现金流与净利润之比',
  missingReasons: '数据缺失说明',
  reviewReasons: '规则未通过原因',
  ruleStatuses: '固定规则检查结果',
  netProfitCagr: '五年净利润复合年增长率',
  deductedProfitRatio: '五年累计扣非归母净利润占归母净利润比例',
  sustainedCashYears: '经营现金流高于净利润的年度数',
  roeRange: '五年加权平均净资产收益率极差（百分点）',
  roeDeclinePoints: '净资产收益率下降幅度（百分点）',
  latestNetProfit: '最近年度净利润',
  latestOperatingCashFlow: '最近年度经营活动现金流净额',
  latestPcfPeRatio: '最近年度市现率与市盈率之比',
  consecutivePcfPeGapYears: '市现率与市盈率比值达到阈值的连续年数',
  consecutiveNegativeCashFlowQuarters: '经营现金流连续为负的季度数',
  receivableRevenueDivergence: '应收账款与营收增速差',
  inventoryTurnover: '存货周转变化',
  goodwillRatio: '商誉占总资产比例',
  dividendYi: '累计分红（亿元）',
  financingYi: '累计融资（亿元）',
  netReturnYi: '分红减融资净额（亿元）',
  ratio: '分红融资比',
  dividendYears: '历史分红年数',
  consecutiveDividendYears: '连续分红年数',
  recent3YearDividendYi: '近三年累计分红（亿元）',
  recent5YearDividendYi: '近五年累计分红（亿元）',
  dividendTrend: '历史分红趋势',
  lastFinancingDate: '最近融资日期',
  qualityScore: '固定规则评分',
  qualityScoreRank: '固定规则评分排名',
  reportDate: '报告期截止日',
  noticeDate: '公告日期',
  reportYear: '财报年度',
  reportType: '财报类型',
  publishedAt: '披露日期',
  managementDiscussion: '管理层讨论二次总结',
  auditOpinion: '审计意见二次总结',
  financialStatementNotes: '财务报表附注二次总结',
  aiConclusion: '财报 AI 综合总结',
  summaryGeneratedAt: '财报总结生成时间',
  summaryModel: '财报总结所用模型',
  priceEarningsRatioTtm: '市盈率（PE TTM）',
  priceBookRatio: '市净率（PB）',
  priceCashFlowRatioTtm: '市现率（PCF TTM）',
  operatingCashFlowTtm: '近十二个月经营活动现金流净额',
  currentValue: '当前数值',
  historicalPercentile: '历史分位',
  historicalSampleSize: '历史样本数',
  industryPercentile: '行业分位',
  industrySampleSize: '行业样本数',
  industryBasisValue: '行业比较基准值',
  priceEarningsComparisonRatio: '市现率与市盈率之比',
  persistentGapYears: '历史市现率与市盈率持续背离年数',
  totalMarketValue: '总市值',
  circulatingMarketValue: '流通市值',
  quoteDataAt: '行情数据时间',
  historyPeriodStart: '历史估值统计起始日',
  historyPeriodEnd: '历史估值统计截止日',
  industryDataAt: '行业估值基准日',
  dataAt: '数据时间',
  dataDate: '数据日期',
  latestTradingDate: '最近交易日',
  currentPrice: '当前价格',
  currentDayChangePercent: '当日涨跌幅',
  return20: '近20个交易日已实现涨跌幅',
  return60: '近60个交易日已实现涨跌幅',
  return120: '近120个交易日已实现涨跌幅',
  return250: '近250个交易日已实现涨跌幅',
  distanceFromMa20: '相对20日均线偏离幅度',
  distanceFromMa60: '相对60日均线偏离幅度',
  distanceFromMa120: '相对120日均线偏离幅度',
  distanceFromMa250: '相对250日均线偏离幅度',
  range250High: '近250个交易日最高价',
  range250Low: '近250个交易日最低价',
  range250Position: '近250个交易日价格区间位置',
  distanceFrom250High: '相对近250个交易日最高价偏离幅度',
  distanceFrom250Low: '相对近250个交易日最低价偏离幅度',
  unavailableReason: '数据不可用原因'
}

const PATH_WRAPPERS = new Set([
  'fundamental',
  'company',
  'dividendFinancing',
  'valuation',
  'priceStrength',
  'item',
  'metrics'
])
const COMMON_ENGLISH_WORDS = new Set([
  ...PATH_WRAPPERS,
  'screening',
  'quality',
  'risk',
  'available',
  'ratio'
])
const DIVIDEND_TRENDS: Record<string, string> = {
  growing: '历史分红增长',
  stable: '历史分红稳定',
  declining: '历史分红下降',
  insufficient: '历史分红数据不足'
}

export function formatLongTermAnalysisText(text: string): string {
  return text
    .replace(
      /https?:\/\/[^\s<>"'`，。；）]+|([A-Za-z][A-Za-z0-9]*(?:\[\d+\])?(?:\.[A-Za-z][A-Za-z0-9]*(?:\[\d+\])?)*)(\s*=\s*)?/gu,
      (match, token: string | undefined, assignment: string | undefined) => {
        if (!token) return match
        const segments = token.split('.')
        // Some existing model outputs dropped the first letter of the root path.
        if (segments.length > 1 && segments[0] === 'undamental') segments[0] = 'fundamental'
        if (
          !segments.every((segment) =>
            Object.hasOwn(LONG_TERM_FIELD_LABELS, segment.replace(/\[\d+\]$/u, ''))
          ) ||
          (segments.length === 1 && !assignment && COMMON_ENGLISH_WORDS.has(token))
        ) {
          return match
        }
        const meaningful = segments.filter(
          (segment) => !PATH_WRAPPERS.has(segment.replace(/\[\d+\]$/u, ''))
        )
        const selected = meaningful.length > 0 ? meaningful : segments.slice(0, 1)
        const label = selected
          .map((segment) => {
            const [, field, index] = segment.match(/^([A-Za-z][A-Za-z0-9]*)(?:\[(\d+)\])?$/u)!
            const label = LONG_TERM_FIELD_LABELS[field]
            if (!label) return segment
            return index === undefined ? label : `${label}（第${Number(index) + 1}项）`
          })
          .join('的')
        return assignment ? `${label}：` : label
      }
    )
    .replace(
      /历史分红趋势\s*[=:：]\s*[`"']?(growing|stable|declining|insufficient)\b[`"']?/gu,
      (_, trend: string) => `历史分红趋势：${DIVIDEND_TRENDS[trend]}`
    )
    .replace(
      /普通企业指标是否适用\s*[=:：]\s*[`"']?(true|false)\b[`"']?/gu,
      (_, applicable: string) => `普通企业指标${applicable === 'true' ? '适用' : '不适用'}`
    )
}

export function normalizeLongTermInterpretation(
  interpretation: AiLongTermInterpretation
): AiLongTermInterpretation {
  return {
    ...interpretation,
    summary: formatLongTermAnalysisText(interpretation.summary),
    sections: interpretation.sections.map((section) => ({
      ...section,
      observation: formatLongTermAnalysisText(section.observation),
      evidence: section.evidence.map(formatLongTermAnalysisText)
    })),
    riskFacts: interpretation.riskFacts.map(formatLongTermAnalysisText),
    uncertainties: interpretation.uncertainties.map(formatLongTermAnalysisText)
  }
}
