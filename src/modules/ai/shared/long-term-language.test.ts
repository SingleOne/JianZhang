import { describe, expect, it } from 'vitest'
import type { AiLongTermInterpretation } from './types'
import { formatLongTermAnalysisText, normalizeLongTermInterpretation } from './long-term-language'

describe('long-term analysis language', () => {
  it('translates the reported financial evidence without changing its numbers', () => {
    const text =
      'undamental.annualReports 2021—2025：parentNetProfit、deductedParentNetProfit、weightedAverageRoe、deductedWeightedAverageRoe、roic、operatingCashFlow、capitalExpenditure、freeCashFlow · fundamental.screening：cumulativeCashConversion=120.7109%、latestCashConversion=160.7024% · fundamental.quality.metrics：netProfitCagr=6.0349%、deductedProfitRatio=95.2331%、sustainedCashYears=3、roeRange=6.23 · dividendFinancing.item：dividendYi=1588.41、financingYi=50.5114、dividendYears=27、consecutiveDividendYears=8、recent3YearDividendYi=463.352、recent5YearDividendYi=743.6635、dividendTrend=growing · companyReportSummaries[0]（2026年半年度报告二次总结，未经审计）：营业总收入896.73亿元、同比-8.14%，归母净利润132.78亿元、同比-7.87%，经营现金流净额188.09亿元、同比-33.60%。'
    const result = formatLongTermAnalysisText(text)

    expect(result).toContain('年度财报 2021—2025：归母净利润、扣非归母净利润')
    expect(result).toContain('五年累计经营现金流与净利润之比：120.7109%')
    expect(result).toContain('五年净利润复合年增长率：6.0349%')
    expect(result).toContain('经营现金流高于净利润的年度数：3')
    expect(result).toContain('五年加权平均净资产收益率极差（百分点）：6.23')
    expect(result).toContain('累计分红（亿元）：1588.41')
    expect(result).toContain('近五年累计分红（亿元）：743.6635')
    expect(result).toContain('历史分红趋势：历史分红增长')
    expect(result).toContain('财报 AI 二次总结（第1项）（2026年半年度报告二次总结，未经审计）')
    expect(result.replace('财报 AI 二次总结（第1项）', '').match(/-?\d+(?:\.\d+)?/gu)).toEqual(
      text
        .replace('companyReportSummaries[0]', '')
        .replace(/[A-Za-z][A-Za-z0-9]*/gu, '')
        .match(/-?\d+(?:\.\d+)?/gu)
    )
    expect(result).not.toMatch(
      /fundamental|parentNetProfit|dividendYi|companyReportSummaries|growing/u
    )
    expect(formatLongTermAnalysisText(result)).toBe(result)
  })

  it('uses Chinese metric names in limitations and retains the valuation context', () => {
    expect(
      formatLongTermAnalysisText(
        'fundamental.company.ordinaryCorporateMetricsApplicable=false；valuation.priceCashFlowRatioTtm.unavailableReason 为数据不足；valuation.priceEarningsRatioTtm.historicalPercentile=42%。'
      )
    ).toBe(
      '普通企业指标不适用；市现率（PCF TTM）的数据不可用原因 为数据不足；市盈率（PE TTM）的历史分位：42%。'
    )
  })

  it.each([
    ['growing', '历史分红增长'],
    ['stable', '历史分红稳定'],
    ['declining', '历史分红下降'],
    ['insufficient', '历史分红数据不足']
  ])('translates the historical dividend trend %s', (value, label) => {
    expect(formatLongTermAnalysisText(`dividendFinancing.item.dividendTrend="${value}"`)).toBe(
      `历史分红趋势：${label}`
    )
  })

  it('preserves readable Chinese, common acronyms, dates, URLs and unrecognized names', () => {
    const text =
      '2026-06-30：归母净利润132.78亿元、同比-7.87%；ROE、ROIC、PE TTM、PB、PCF、DCF；https://example.com/report.pdf；https://company.com/quality/parentNetProfit；company.com；GPT-5.6；company quality and risk；item is available。'
    expect(formatLongTermAnalysisText(text)).toBe(text)
  })

  it('normalizes all saved user-facing text without changing section ids or model references', () => {
    const saved: AiLongTermInterpretation = {
      schemaVersion: 3,
      summary: 'fundamental.annualReports 覆盖2021—2025年。',
      sections: [
        {
          id: 'operatingMetrics',
          observation: 'parentNetProfit 为132.78亿元。',
          evidence: ['operatingCashFlow 为188.09亿元。']
        },
        { id: 'financialStructure', observation: 'netDebt 为负。', evidence: [] },
        { id: 'valuationMetrics', observation: 'priceBookRatio=1.2', evidence: [] }
      ],
      modelCalculationReference: 'DCF 标准句保留8%与10元至15元。',
      riskFacts: ['latestCashConversion=95%'],
      uncertainties: ['companyReportSummaries[0] 为二次总结，未经审计。'],
      generatedAt: '2026-10-28T10:00:00+08:00'
    }
    const result = normalizeLongTermInterpretation(saved)

    expect(result.summary).toBe('年度财报 覆盖2021—2025年。')
    expect(result.sections[0].observation).toBe('归母净利润 为132.78亿元。')
    expect(result.sections[0].evidence).toEqual(['经营活动现金流净额 为188.09亿元。'])
    expect(result.sections[1].observation).toBe('净负债 为负。')
    expect(result.sections[2].observation).toBe('市净率（PB）：1.2')
    expect(result.riskFacts).toEqual(['最近年度经营现金流与净利润之比：95%'])
    expect(result.uncertainties).toEqual(['财报 AI 二次总结（第1项） 为二次总结，未经审计。'])
    expect(result.sections.map((section) => section.id)).toEqual(
      saved.sections.map((section) => section.id)
    )
    expect(result.modelCalculationReference).toBe(saved.modelCalculationReference)
    expect(result.generatedAt).toBe(saved.generatedAt)
    expect(saved.sections[0].observation).toBe('parentNetProfit 为132.78亿元。')
    expect(normalizeLongTermInterpretation(result)).toEqual(result)
  })
})
