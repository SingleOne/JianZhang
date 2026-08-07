import type {
  CompanyReportItem,
  CompanyReportSummarySections,
  CompanyReportType,
  CompanyReportVariant
} from '../shared/types'

export const COMPANY_REPORT_TYPE_LABELS: Record<CompanyReportType, string> = {
  annual: '年报',
  semiannual: '半年报',
  firstQuarter: '一季报',
  thirdQuarter: '三季报'
}

export const COMPANY_REPORT_READING_HINTS: Record<CompanyReportType, string> = {
  annual: '信息最完整且经过审计，优先阅读经营情况、审计意见、三张主表和附注。',
  semiannual: '用于检查上半年经营趋势、现金流和资产负债变化，通常未经审计。',
  firstQuarter: '适合观察开年趋势，但单季度波动较大，应与行业季节性一起判断。',
  thirdQuarter: '用于确认全年趋势是否延续，并留意年末前的现金流和负债压力。'
}

export function normalizeCompanyReportTitle(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  }
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_match, entity: string) => {
      if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
      if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
      return named[entity.toLowerCase()] ?? `&${entity};`
    })
    .replace(/\s+/g, ' ')
    .trim()
}

export function companyReportYear(
  title: string,
  reportType: CompanyReportType,
  publishedAt: string
): number {
  const matched = title.match(/((?:19|20)\d{2})\s*年/)
  if (matched) return Number(matched[1])
  const publishedYear = new Date(publishedAt).getFullYear()
  return reportType === 'annual' ? publishedYear - 1 : publishedYear
}

export function companyReportVariant(title: string): CompanyReportVariant {
  if (/英文版|英文报告|English/i.test(title)) return 'english'
  if (/摘要/.test(title)) return 'summary'
  return 'full'
}

export function isAmendedCompanyReport(title: string): boolean {
  return /修订|更正|更新后|补充版/.test(title)
}

export function sortCompanyReports(reports: CompanyReportItem[]): CompanyReportItem[] {
  return [...reports].sort(
    (left, right) =>
      right.reportYear - left.reportYear ||
      right.publishedAt.localeCompare(left.publishedAt) ||
      left.title.localeCompare(right.title, 'zh-CN')
  )
}

export function limitCompanyReportsToRecentYears(
  reports: CompanyReportItem[],
  yearCount = 5
): CompanyReportItem[] {
  if (reports.length === 0) return []
  const latestYear = Math.max(...reports.map((report) => report.reportYear))
  return reports.filter((report) => report.reportYear >= latestYear - yearCount + 1)
}

export function createCompanyReportSummaryExcerpt(text: string, maxCharacters = 70_000): string {
  const normalized = text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const headings = [
    '公司业务概要',
    '主要会计数据和财务指标',
    '管理层讨论与分析',
    '审计报告',
    '合并资产负债表',
    '合并利润表',
    '合并现金流量表',
    '财务报表附注'
  ]
  const matchedSections = headings.flatMap((heading) => {
    const index = normalized.indexOf(heading)
    return index >= 0 ? [index] : []
  })
  const openingCharacters = Math.min(8_000, Math.floor(maxCharacters / 2))
  const sectionCharacters = matchedSections.length > 0
    ? Math.max(1, Math.floor(
      (maxCharacters - openingCharacters - matchedSections.length * 2) / matchedSections.length
    ))
    : 0
  const sections = [
    normalized.slice(0, openingCharacters),
    ...matchedSections.map((index) => normalized.slice(index, index + sectionCharacters))
  ]
  return sections.join('\n\n').slice(0, maxCharacters)
}

export function parseCompanyReportSummary(content: string): CompanyReportSummarySections {
  const json = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('AI 没有返回符合要求的财报总结格式')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('AI 返回的财报总结格式无效')
  }
  const record = raw as Record<string, unknown>
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null
  const aiConclusion = text(record.aiConclusion)
  if (!aiConclusion) throw new Error('AI 财报总结缺少综合结论')
  return {
    managementDiscussion: text(record.managementDiscussion),
    auditOpinion: text(record.auditOpinion),
    financialStatementNotes: text(record.financialStatementNotes),
    aiConclusion
  }
}
