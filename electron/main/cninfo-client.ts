import { BROWSER_USER_AGENT } from './http-user-agent'
import { OfficialSourceHttpError, requestOfficialSourceBytes } from './official-source-request'

const STOCK_LIST_URL = 'https://www.cninfo.com.cn/new/data/szse_stock.json'
const STOCK_LIST_MIRROR_URL = 'https://static.cninfo.com.cn/new/data/szse_stock.json'
const ANNOUNCEMENT_URL = 'https://www.cninfo.com.cn/new/hisAnnouncement/query'
const SEARCH_URL = 'https://www.cninfo.com.cn/new/fulltextSearch/full'
const SEARCH_PAGE_SIZE = 100
const REQUEST_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://www.cninfo.com.cn',
  Referer: 'https://www.cninfo.com.cn/',
  'User-Agent': BROWSER_USER_AGENT,
  'X-Requested-With': 'XMLHttpRequest'
}

interface CninfoStock {
  code?: string
  orgId?: string
  category?: string
  zwjc?: string
}

export interface CninfoOrganization {
  orgId: string
  name: string
}

export interface CninfoAnnouncement {
  secCode?: string
  orgId?: string
  announcementId?: string
  announcementTitle?: string
  announcementTime?: number
  adjunctUrl?: string
}

export interface CninfoAnnouncementResponse {
  announcements?: CninfoAnnouncement[] | null
  totalAnnouncement?: number
  totalRecordNum?: number
}

class CninfoHttpError extends Error {
  constructor(readonly status: number) {
    super(`请求巨潮资讯失败：HTTP ${status}`)
  }
}

export function isCninfoForbidden(error: unknown): boolean {
  return error instanceof CninfoHttpError && error.status === 403
}

export function cninfoMarketParams(code: string, orgId: string): { column: string; plate: string } {
  if (orgId.includes('bj')) return { column: 'szse', plate: 'bj' }
  if (code.startsWith('6')) return { column: 'sse', plate: 'sh' }
  return { column: 'szse', plate: 'sz' }
}

export class CninfoClient {
  private stockOrganizations: Promise<Map<string, CninfoOrganization>> | null = null

  async getOrganization(code: string): Promise<CninfoOrganization | undefined> {
    if (!this.stockOrganizations) {
      this.stockOrganizations = this.loadStockOrganizations().catch((error) => {
        this.stockOrganizations = null
        throw error
      })
    }
    return (await this.stockOrganizations).get(code)
  }

  queryAnnouncements(body: URLSearchParams): Promise<CninfoAnnouncementResponse> {
    return this.requestJson(ANNOUNCEMENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body.toString()
    })
  }

  async searchAnnouncements(
    code: string,
    organization: CninfoOrganization,
    periodStart = '',
    periodEnd = '',
    limit = Infinity,
    keyword = ''
  ): Promise<CninfoAnnouncement[]> {
    const announcements = new Map<string, CninfoAnnouncement>()
    let pageCount = 1
    for (let page = 1; page <= pageCount && announcements.size < limit; page++) {
      const url = new URL(SEARCH_URL)
      url.search = new URLSearchParams({
        // Names find earlier announcements after a stock-code change as well.
        searchkey: keyword ? `${organization.name} ${keyword}` : organization.name,
        sdate: periodStart,
        edate: periodEnd,
        isfulltext: 'false',
        sortName: 'pubdate',
        sortType: 'desc',
        pageNum: String(page),
        pageSize: String(SEARCH_PAGE_SIZE)
      }).toString()
      const payload = await this.requestJson<CninfoAnnouncementResponse>(url.toString())
      pageCount = Math.max(
        1,
        Math.ceil((payload.totalRecordNum ?? payload.totalAnnouncement ?? 0) / SEARCH_PAGE_SIZE)
      )
      for (const item of payload.announcements ?? []) {
        // Another issuer can mention this company. orgId survives code changes.
        if (item.orgId ? item.orgId !== organization.orgId : item.secCode !== code) continue
        if (
          item.announcementId &&
          item.announcementTitle &&
          item.announcementTime &&
          item.adjunctUrl
        ) {
          announcements.set(item.announcementId, item)
        }
      }
    }
    return [...announcements.values()].slice(0, limit)
  }

  private async loadStockOrganizations(): Promise<Map<string, CninfoOrganization>> {
    let payload: { stockList?: CninfoStock[] }
    try {
      payload = await this.requestJson(STOCK_LIST_URL)
    } catch (error) {
      if (!isCninfoForbidden(error)) throw error
      // The same public stock directory is also published on the official static host.
      payload = await this.requestJson(STOCK_LIST_MIRROR_URL)
    }
    return new Map(
      (payload.stockList ?? [])
        .filter(
          (item): item is CninfoStock & { code: string; orgId: string } =>
            item.category === 'A股' && Boolean(item.code && item.orgId)
        )
        .map((item) => [item.code, { orgId: item.orgId, name: item.zwjc || item.code }])
    )
  }

  private async requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(REQUEST_HEADERS)
    new Headers(init.headers).forEach((value, name) => headers.set(name, value))
    if (new URL(url).hostname === 'static.cninfo.com.cn') {
      headers.delete('Origin')
      headers.delete('X-Requested-With')
    }
    try {
      const { bytes } = await requestOfficialSourceBytes(url, { ...init, headers })
      return JSON.parse(new TextDecoder().decode(bytes)) as T
    } catch (error) {
      if (error instanceof OfficialSourceHttpError) throw new CninfoHttpError(error.status)
      throw error
    }
  }
}
