import type { CompanyReportItem, CompanyReportType, CompanyReportVariant } from '../shared/types'

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

export function companyReportYear(title: string, publishedAt: string): number {
  const matched = title.match(/((?:19|20)\d{2})\s*年/)
  return matched ? Number(matched[1]) : new Date(publishedAt).getFullYear()
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
