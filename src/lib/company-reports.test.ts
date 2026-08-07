import { describe, expect, it } from 'vitest'
import {
  companyReportVariant,
  companyReportYear,
  createCompanyReportSummaryExcerpt,
  isAmendedCompanyReport,
  limitCompanyReportsToRecentYears,
  normalizeCompanyReportTitle,
  parseCompanyReportSummary,
  sortCompanyReports
} from './company-reports'
import type { CompanyReportItem } from '../shared/types'

describe('company report helpers', () => {
  it('normalizes titles and identifies the fiscal year', () => {
    const title = normalizeCompanyReportTitle('<em>贵州茅台</em>2025年年度报告&amp;摘要')
    expect(title).toBe('贵州茅台2025年年度报告&摘要')
    expect(companyReportYear(title, '2026-04-03T00:00:00.000Z')).toBe(2025)
  })

  it('classifies full, summary, English and amended reports', () => {
    expect(companyReportVariant('2025年年度报告')).toBe('full')
    expect(companyReportVariant('2025年年度报告摘要')).toBe('summary')
    expect(companyReportVariant('2025年年度报告（英文版）')).toBe('english')
    expect(isAmendedCompanyReport('2025年年度报告（修订版）')).toBe(true)
  })

  it('sorts reports by fiscal year and publication time', () => {
    const report = (id: string, reportYear: number, publishedAt: string): CompanyReportItem => ({
      id,
      code: '600519',
      title: id,
      reportType: 'annual',
      reportYear,
      variant: 'full',
      amended: false,
      publishedAt,
      url: `https://static.cninfo.com.cn/${id}.pdf`
    })
    expect(
      sortCompanyReports([
        report('older', 2024, '2025-04-01T00:00:00.000Z'),
        report('latest', 2025, '2026-04-01T00:00:00.000Z'),
        report('revised', 2025, '2026-04-03T00:00:00.000Z')
      ]).map((item) => item.id)
    ).toEqual(['revised', 'latest', 'older'])
  })

  it('keeps only the latest five reporting years', () => {
    const reports = Array.from({ length: 7 }, (_, index): CompanyReportItem => ({
      id: String(index),
      code: '600519',
      title: `${2019 + index}年年度报告`,
      reportType: 'annual',
      reportYear: 2019 + index,
      variant: 'full',
      amended: false,
      publishedAt: `${2020 + index}-04-01T00:00:00.000Z`,
      url: `https://static.cninfo.com.cn/${index}.pdf`
    }))
    expect(limitCompanyReportsToRecentYears(reports).map((report) => report.reportYear)).toEqual([
      2021, 2022, 2023, 2024, 2025
    ])
  })

  it('selects useful financial report sections for AI summary context', () => {
    const text = `封面\n${'公司介绍'.repeat(2000)}\n管理层讨论与分析\n${'经营保持稳定'.repeat(2000)}\n审计报告\n标准无保留意见\n${'审计内容'.repeat(2000)}\n财务报表附注\n存在重要减值事项`
    const excerpt = createCompanyReportSummaryExcerpt(text, 20_000)
    expect(excerpt).toContain('管理层讨论与分析')
    expect(excerpt).toContain('标准无保留意见')
    expect(excerpt).toContain('存在重要减值事项')
  })

  it('parses structured report summaries for long-term analysis', () => {
    const summary = parseCompanyReportSummary(`\`\`\`json
      {
        "managementDiscussion": "主营业务保持增长",
        "auditOpinion": "标准无保留意见",
        "financialStatementNotes": null,
        "aiConclusion": "经营稳定，但仍需关注现金流"
      }
    \`\`\``)

    expect(summary).toEqual({
      managementDiscussion: '主营业务保持增长',
      auditOpinion: '标准无保留意见',
      financialStatementNotes: null,
      aiConclusion: '经营稳定，但仍需关注现金流'
    })
  })
})
