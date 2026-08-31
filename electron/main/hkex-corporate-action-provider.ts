import { createHash } from 'node:crypto'
import {
  classifyCorporateAction,
  extractCorporateActionDates,
  extractCorporateActionTerms
} from '../../src/lib/corporate-actions'
import type { CorporateActionCandidate, CorporateActionListResult } from '../../src/shared/types'
import {
  corporateActionCodeFromQuoteId,
  corporateActionPeriodRange,
  type CorporateActionProvider
} from './corporate-action-provider'
import {
  HkexNewsClient,
  hkexDocumentUrl,
  hkexPublishedAt,
  type HkexSearchItem
} from './hkex-news-client'

const CATEGORY_CODES = [
  '13250',
  '13251',
  '18120',
  '18140',
  '18500',
  '18460',
  '12700',
  '17450',
  '17700',
  '17600',
  '18260'
] as const

const CATEGORY_GROUP_CODES: Record<(typeof CATEGORY_CODES)[number], string> = {
  '13250': '3',
  '13251': '3',
  '18120': '8',
  '18140': '8',
  '18500': '8',
  '18460': '8',
  '12700': '2',
  '17450': '7',
  '17700': '7',
  '17600': '7',
  '18260': '8'
}

function contentHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export class HkexCorporateActionProvider implements CorporateActionProvider {
  readonly market = 'HK' as const

  constructor(private readonly client = new HkexNewsClient()) {}

  async fetch(quoteId: string): Promise<CorporateActionListResult> {
    const code = corporateActionCodeFromQuoteId(quoteId).padStart(5, '0')
    if (!/^\d{5}$/.test(code)) throw new Error('港股代码无效')
    const stock = await this.client.resolveStock(code)
    const { periodStart, periodEnd } = corporateActionPeriodRange()
    const groups: HkexSearchItem[][] = []
    for (const categoryCode of CATEGORY_CODES) {
      groups.push(
        await this.client.search(
          stock.stockId!,
          periodStart,
          periodEnd,
          '10000',
          categoryCode,
          CATEGORY_GROUP_CODES[categoryCode]
        )
      )
    }
    const detectedAt = new Date().toISOString()
    const candidates = new Map<string, CorporateActionCandidate>()
    for (const item of groups.flat()) {
      const candidate = this.mapCandidate(quoteId, item, detectedAt)
      if (candidate) candidates.set(candidate.providerEventId, candidate)
    }
    return {
      quoteId,
      market: 'HK',
      source: 'HKEXnews',
      fetchedAt: detectedAt,
      fromCache: false,
      candidates: [...candidates.values()].sort((left, right) =>
        right.announcementDate.localeCompare(left.announcementDate)
      )
    }
  }

  private mapCandidate(
    quoteId: string,
    item: HkexSearchItem,
    detectedAt: string
  ): CorporateActionCandidate | null {
    if (!item.NEWS_ID || !item.TITLE || !item.DATE_TIME || !item.FILE_LINK) return null
    const text = `${item.TITLE} ${item.LONG_TEXT ?? ''}`
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
    const type = classifyCorporateAction(text)
    if (!type) return null
    const publishedAt = hkexPublishedAt(item.DATE_TIME)
    const url = hkexDocumentUrl(item.FILE_LINK)
    const hash = contentHash(`${item.NEWS_ID}|${text}|${item.DATE_TIME}|${url}`)
    return {
      id: `hkex:${item.NEWS_ID}`,
      quoteId,
      market: 'HK',
      type,
      status: 'detected',
      title: item.TITLE.replace(/<[^>]+>/g, '').trim(),
      announcementDate: publishedAt.slice(0, 10),
      ...extractCorporateActionDates(text),
      terms: extractCorporateActionTerms(type, text, quoteId),
      evidence: [
        {
          source: 'HKEXnews',
          title: item.TITLE.replace(/<[^>]+>/g, '').trim(),
          url,
          publishedAt,
          excerpt: item.LONG_TEXT?.replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        }
      ],
      providerId: 'hkex-news',
      providerEventId: item.NEWS_ID,
      contentHash: hash,
      detectedAt
    }
  }
}
