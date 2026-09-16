import { createHash } from 'node:crypto'
import { net } from 'electron'
import pdfParse from 'pdf-parse'
import {
  extractCnCorporateActionEffects,
  extractCorporateActionDates,
  extractCorporateActionTerms
} from '../../src/lib/corporate-actions'
import type { CorporateActionCandidate, CorporateActionListResult } from '../../src/shared/types'
import {
  corporateActionCodeFromQuoteId,
  corporateActionPeriodRange,
  type CorporateActionProvider
} from './corporate-action-provider'

const STOCK_LIST_URL = 'https://www.cninfo.com.cn/new/data/szse_stock.json'
const ANNOUNCEMENT_URL = 'https://www.cninfo.com.cn/new/hisAnnouncement/query'
const PDF_BASE_URL = 'https://static.cninfo.com.cn/'
const PAGE_SIZE = 30
const SEARCH_KEYWORDS = ['权益分派', '利润分配', '分红派息', '配股'] as const
const CNINFO_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const API_REQUEST_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://www.cninfo.com.cn',
  Referer: 'https://www.cninfo.com.cn/',
  'User-Agent': CNINFO_USER_AGENT,
  'X-Requested-With': 'XMLHttpRequest'
}
const DOCUMENT_REQUEST_HEADERS = {
  Accept: 'application/pdf, application/octet-stream;q=0.9, */*;q=0.8',
  Referer: 'https://www.cninfo.com.cn/',
  'User-Agent': CNINFO_USER_AGENT
}
const DISTRIBUTION_IMPLEMENTATION =
  /(?:权益分派|利润分配|分红派息).*(?:实施公告|实施结果公告)|(?:实施|实施结果).*(?:权益分派|利润分配|分红派息)/
const RIGHTS_IMPLEMENTATION = /配股.*(?:发行公告|实施公告|结果公告|股份变动|获配股票上市|上市公告)/
const NON_ACTIONABLE_TITLE = /预案|董事会决议|股东大会决议|提示性公告|问询函|回复公告|取消|终止/
const BODY_FETCH_CONCURRENCY = 3

interface CninfoStock {
  code?: string
  orgId?: string
  category?: string
}

interface CninfoAnnouncementPayload {
  secCode?: string
  announcementId?: string
  announcementTitle?: string
  announcementTime?: number
  adjunctUrl?: string
}

interface CninfoAnnouncementResponse {
  announcements?: CninfoAnnouncementPayload[] | null
  totalAnnouncement?: number
}

export interface CninfoCorporateActionAnnouncement {
  id: string
  title: string
  publishedAt: string
  url: string
}

export interface CninfoCorporateActionClientLike {
  listAnnouncements(
    code: string,
    periodStart: string,
    periodEnd: string
  ): Promise<CninfoCorporateActionAnnouncement[]>
  getDocumentText(url: string): Promise<string>
}

function normalizeTitle(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeDocumentText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 300_000)
}

function distributionEventKey(title: string, fallbackDate: string): string {
  const period = normalizeTitle(title).match(
    /(20\d{2})\s*(?:年\s*)?(年度|半年度|中期|第一季度|一季度|第三季度|三季度)/
  )
  return period ? `${period[1]}-${period[2]}` : fallbackDate
}

export function isCnCorporateActionImplementationTitle(title: string): boolean {
  const normalized = normalizeTitle(title)
  if (NON_ACTIONABLE_TITLE.test(normalized)) return false
  return DISTRIBUTION_IMPLEMENTATION.test(normalized) || RIGHTS_IMPLEMENTATION.test(normalized)
}

async function mapInBatches<T, R>(
  items: readonly T[],
  batchSize: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  for (let index = 0; index < items.length; index += batchSize) {
    results.push(...(await Promise.all(items.slice(index, index + batchSize).map(mapper))))
  }
  return results
}

export class CninfoCorporateActionClient implements CninfoCorporateActionClientLike {
  private stockOrganizations: Promise<Map<string, string>> | null = null

  async listAnnouncements(
    code: string,
    periodStart: string,
    periodEnd: string
  ): Promise<CninfoCorporateActionAnnouncement[]> {
    const organizations = await this.getStockOrganizations()
    const orgId = organizations.get(code)
    if (!orgId) throw new Error(`巨潮资讯未找到股票 ${code}`)
    const announcements = new Map<string, CninfoCorporateActionAnnouncement>()
    for (const keyword of SEARCH_KEYWORDS) {
      const pages = await this.fetchAllPages(code, orgId, keyword, periodStart, periodEnd)
      for (const item of pages.flatMap((page) => page.announcements ?? [])) {
        if (
          item.secCode !== code ||
          !item.announcementId ||
          !item.announcementTitle ||
          typeof item.announcementTime !== 'number' ||
          !item.adjunctUrl
        ) {
          continue
        }
        announcements.set(item.announcementId, {
          id: item.announcementId,
          title: normalizeTitle(item.announcementTitle),
          publishedAt: new Date(item.announcementTime).toISOString(),
          url: new URL(item.adjunctUrl, PDF_BASE_URL).toString()
        })
      }
    }
    return [...announcements.values()].sort((left, right) =>
      right.publishedAt.localeCompare(left.publishedAt)
    )
  }

  async getDocumentText(url: string): Promise<string> {
    const response = await net.fetch(url, {
      headers: DOCUMENT_REQUEST_HEADERS,
      signal: AbortSignal.timeout(45_000)
    })
    if (!response.ok) throw new Error(`请求巨潮资讯公告失败：HTTP ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    return normalizeDocumentText((await pdfParse(buffer)).text)
  }

  private async fetchAllPages(
    code: string,
    orgId: string,
    keyword: string,
    periodStart: string,
    periodEnd: string
  ): Promise<CninfoAnnouncementResponse[]> {
    const first = await this.fetchPage(code, orgId, keyword, periodStart, periodEnd, 1)
    const pageCount = Math.max(1, Math.ceil((first.totalAnnouncement ?? 0) / PAGE_SIZE))
    const remaining = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, index) =>
        this.fetchPage(code, orgId, keyword, periodStart, periodEnd, index + 2)
      )
    )
    return [first, ...remaining]
  }

  private async fetchPage(
    code: string,
    orgId: string,
    keyword: string,
    periodStart: string,
    periodEnd: string,
    pageNumber: number
  ): Promise<CninfoAnnouncementResponse> {
    const { column, plate } = this.marketParams(code, orgId)
    const body = new URLSearchParams({
      pageNum: String(pageNumber),
      pageSize: String(PAGE_SIZE),
      column,
      tabName: 'fulltext',
      plate,
      stock: `${code},${orgId}`,
      searchkey: keyword,
      secid: '',
      category: '',
      trade: '',
      seDate: `${periodStart}~${periodEnd}`,
      sortName: 'time',
      sortType: 'desc',
      isHLtitle: 'true'
    })
    const response = await net.fetch(ANNOUNCEMENT_URL, {
      method: 'POST',
      headers: {
        ...API_REQUEST_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) throw new Error(`请求巨潮资讯失败：HTTP ${response.status}`)
    return response.json() as Promise<CninfoAnnouncementResponse>
  }

  private getStockOrganizations(): Promise<Map<string, string>> {
    if (!this.stockOrganizations) {
      this.stockOrganizations = net
        .fetch(STOCK_LIST_URL, {
          headers: API_REQUEST_HEADERS,
          signal: AbortSignal.timeout(15_000)
        })
        .then(async (response) => {
          if (!response.ok) throw new Error(`请求巨潮资讯股票列表失败：HTTP ${response.status}`)
          return response.json() as Promise<{ stockList?: CninfoStock[] }>
        })
        .then(
          (payload) =>
            new Map(
              (payload.stockList ?? [])
                .filter(
                  (item): item is CninfoStock & { code: string; orgId: string } =>
                    item.category === 'A股' && Boolean(item.code && item.orgId)
                )
                .map((item) => [item.code, item.orgId])
            )
        )
        .catch((reason) => {
          this.stockOrganizations = null
          throw reason
        })
    }
    return this.stockOrganizations
  }

  private marketParams(code: string, orgId: string): { column: string; plate: string } {
    if (orgId.includes('bj')) return { column: 'szse', plate: 'bj' }
    if (code.startsWith('6')) return { column: 'sse', plate: 'sh' }
    return { column: 'szse', plate: 'sz' }
  }
}

type AnnouncementScanResult = {
  candidates: CorporateActionCandidate[]
  failure?: string
  unparsed?: boolean
}

export class CninfoCorporateActionProvider implements CorporateActionProvider {
  readonly market = 'CN' as const

  constructor(
    private readonly client: CninfoCorporateActionClientLike = new CninfoCorporateActionClient()
  ) {}

  async fetch(quoteId: string): Promise<CorporateActionListResult> {
    const code = corporateActionCodeFromQuoteId(quoteId)
    if (!/^\d{6}$/.test(code)) throw new Error('A股代码无效')
    const { periodStart, periodEnd } = corporateActionPeriodRange()
    const announcements = (
      await this.client.listAnnouncements(code, periodStart, periodEnd)
    ).filter((item) => isCnCorporateActionImplementationTitle(item.title))
    const scans = await mapInBatches(announcements, BODY_FETCH_CONCURRENCY, (announcement) =>
      this.scanAnnouncement(quoteId, announcement)
    )
    const failures = scans.flatMap(({ failure }) => (failure ? [failure] : []))
    const unparsedCount = scans.filter(({ unparsed }) => unparsed).length
    if (announcements.length > 0 && failures.length === announcements.length) {
      throw new Error(`巨潮资讯实施公告正文全部获取失败：${failures.slice(0, 3).join('；')}`)
    }
    const candidates = new Map<string, CorporateActionCandidate>()
    for (const candidate of scans.flatMap((scan) => scan.candidates)) {
      const previous = candidates.get(candidate.id)
      if (!previous || candidate.evidence[0].publishedAt > previous.evidence[0].publishedAt) {
        candidates.set(candidate.id, candidate)
      }
    }
    const degraded = failures.length > 0 || unparsedCount > 0
    const warningParts = [
      failures.length > 0 ? `${failures.length} 份实施公告正文获取失败` : '',
      unparsedCount > 0 ? `${unparsedCount} 份实施公告未能提取可入账条款` : ''
    ].filter(Boolean)
    return {
      quoteId,
      market: 'CN',
      source: '巨潮资讯',
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      degraded,
      warning: degraded
        ? `A股公司行动数据不完整：${warningParts.join('；')}，请核对官方原文并按券商实际到账补录。`
        : undefined,
      candidates: [...candidates.values()].sort((left, right) =>
        right.announcementDate.localeCompare(left.announcementDate)
      )
    }
  }

  private async scanAnnouncement(
    quoteId: string,
    announcement: CninfoCorporateActionAnnouncement
  ): Promise<AnnouncementScanResult> {
    try {
      const text = await this.client.getDocumentText(announcement.url)
      if (RIGHTS_IMPLEMENTATION.test(announcement.title)) {
        return {
          candidates: [this.createRightsCandidate(quoteId, announcement, text)]
        }
      }
      const effects = extractCnCorporateActionEffects(text)
      if (effects.length === 0) return { candidates: [], unparsed: true }
      const dates = extractCorporateActionDates(text)
      const detectedAt = new Date().toISOString()
      const eventKey = distributionEventKey(
        announcement.title,
        dates.recordDate ?? dates.exDate ?? announcement.publishedAt.slice(0, 10)
      )
      return {
        candidates: effects.map((effect): CorporateActionCandidate => {
          const suffix = effect.type === 'cashDividend' ? 'cash' : 'shares'
          const titleSuffix = effect.type === 'cashDividend' ? '现金分红' : '送股/转增'
          return {
            id: `cninfo:${quoteId}:${eventKey}:${suffix}`,
            quoteId,
            market: 'CN',
            type: effect.type,
            status: dates.recordDate ? 'detected' : 'needsReview',
            title: `${announcement.title} · ${titleSuffix}`,
            announcementDate: announcement.publishedAt.slice(0, 10),
            ...dates,
            terms: effect.terms,
            evidence: [
              {
                source: '巨潮资讯',
                title: announcement.title,
                url: announcement.url,
                publishedAt: announcement.publishedAt,
                excerpt: text.slice(0, 4_000)
              }
            ],
            providerId: 'cninfo-corporate-actions',
            providerEventId: announcement.id,
            contentHash: createHash('sha256')
              .update(`${announcement.id}|${announcement.title}|${effect.type}|${text}`)
              .digest('hex'),
            detectedAt,
            warning: dates.recordDate
              ? undefined
              : '未能自动提取股权登记日，请核对公告原文和券商实际到账。'
          }
        })
      }
    } catch (reason) {
      return {
        candidates: [],
        failure: `${announcement.id}：${reason instanceof Error ? reason.message : String(reason)}`
      }
    }
  }

  private createRightsCandidate(
    quoteId: string,
    announcement: CninfoCorporateActionAnnouncement,
    text: string
  ): CorporateActionCandidate {
    const dates = extractCorporateActionDates(text)
    const eventDate = dates.recordDate ?? announcement.publishedAt.slice(0, 10)
    return {
      id: `cninfo:${quoteId}:${eventDate}:rights`,
      quoteId,
      market: 'CN',
      type: 'rightsIssue',
      status: 'needsReview',
      title: announcement.title,
      announcementDate: announcement.publishedAt.slice(0, 10),
      ...dates,
      terms: extractCorporateActionTerms('rightsIssue', text, quoteId),
      evidence: [
        {
          source: '巨潮资讯',
          title: announcement.title,
          url: announcement.url,
          publishedAt: announcement.publishedAt,
          excerpt: text.slice(0, 4_000)
        }
      ],
      providerId: 'cninfo-corporate-actions',
      providerEventId: announcement.id,
      contentHash: createHash('sha256')
        .update(`${announcement.id}|${announcement.title}|rightsIssue|${text}`)
        .digest('hex'),
      detectedAt: new Date().toISOString(),
      warning: '配股参与结果必须以券商实际认购数量、价格和费用为准。'
    }
  }
}
