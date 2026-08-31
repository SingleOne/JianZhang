import { net } from 'electron'

const HKEX_BASE_URL = 'https://www1.hkexnews.hk'
const HKEX_SEARCH_URL = `${HKEX_BASE_URL}/search/titleSearchServlet.do`
const HKEX_PREFIX_URL = `${HKEX_BASE_URL}/search/prefix.do`
const HKEX_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Referer: `${HKEX_BASE_URL}/search/titlesearch.xhtml?lang=en`,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

export interface HkexStockInfo {
  stockId?: number
  code?: string
  name?: string
}

export interface HkexSearchItem {
  NEWS_ID?: string
  TITLE?: string
  DATE_TIME?: string
  FILE_LINK?: string
  FILE_TYPE?: string
  LONG_TEXT?: string
}

interface HkexSearchResponse {
  result?: string
}

function compactDate(date: string): string {
  return date.replaceAll('-', '')
}

export function hkexPublishedAt(value: string): string {
  const matched = value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/)
  if (!matched) return new Date(value).toISOString()
  return `${matched[3]}-${matched[2]}-${matched[1]}T${matched[4] ?? '00'}:${matched[5] ?? '00'}:00+08:00`
}

export function hkexDocumentUrl(fileLink: string): string {
  return new URL(fileLink, HKEX_BASE_URL).toString()
}

export class HkexNewsClient {
  async resolveStock(code: string): Promise<HkexStockInfo> {
    const url = new URL(HKEX_PREFIX_URL)
    url.search = new URLSearchParams({
      callback: 'callback',
      lang: 'EN',
      type: 'A',
      name: code,
      market: 'SEHK'
    }).toString()
    const response = await net.fetch(url.toString(), {
      headers: HKEX_HEADERS,
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) throw new Error(`请求 HKEXnews 失败：HTTP ${response.status}`)
    const payload = (await response.text()).replace(/^callback\(/, '').replace(/\);?$/, '')
    const stocks = (JSON.parse(payload) as { stockInfo?: HkexStockInfo[] }).stockInfo ?? []
    const stock = stocks.find((item) => item.code === code && Number.isFinite(item.stockId))
    if (!stock) throw new Error(`HKEXnews 未找到港股代码 ${code}`)
    return stock
  }

  async search(
    stockId: number,
    periodStart: string,
    periodEnd: string,
    tierOneCode: string,
    tierTwoCode = '-2',
    tierTwoGroupCode = '-2'
  ): Promise<HkexSearchItem[]> {
    const url = new URL(HKEX_SEARCH_URL)
    url.search = new URLSearchParams({
      sortDir: '0',
      sortByOptions: 'DateTime',
      category: '0',
      market: 'SEHK',
      stockId: String(stockId),
      documentType: '-1',
      fromDate: compactDate(periodStart),
      toDate: compactDate(periodEnd),
      title: '',
      searchType: '1',
      t1code: tierOneCode,
      t2Gcode: tierTwoGroupCode,
      t2code: tierTwoCode,
      rowRange: '100',
      lang: 'EN'
    }).toString()
    const response = await net.fetch(url.toString(), {
      headers: HKEX_HEADERS,
      signal: AbortSignal.timeout(20_000)
    })
    if (!response.ok) throw new Error(`请求 HKEXnews 失败：HTTP ${response.status}`)
    const payload = (await response.json()) as HkexSearchResponse
    return payload.result ? (JSON.parse(payload.result) as HkexSearchItem[]) : []
  }
}
