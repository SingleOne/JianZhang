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
import { SecEdgarClient, type SecSubmissionsRecent } from './sec-edgar-client'

const CANDIDATE_FORMS = new Set([
  '8-K',
  '8-K/A',
  '6-K',
  '6-K/A',
  'DEF 14A',
  'DEFA14A',
  'PRE 14A',
  'S-4',
  'S-4/A',
  '20-F',
  '20-F/A'
])
const ACTION_DESCRIPTION =
  /dividend|distribution|split|reverse split|rights|merger|acquisition|exchange|symbol|ticker|name change|delisting|spin.?off|capital return/i

function valueAt(values: string[] | undefined, index: number): string {
  return values?.[index] ?? ''
}

export class SecCorporateActionProvider implements CorporateActionProvider {
  readonly market = 'US' as const

  constructor(private readonly client: SecEdgarClient) {}

  async fetch(quoteId: string): Promise<CorporateActionListResult> {
    const code = corporateActionCodeFromQuoteId(quoteId).toUpperCase()
    const issuer = await this.client.resolveIssuer(code)
    const submissions = await this.client.getSubmissions(issuer.cik)
    const { periodStart } = corporateActionPeriodRange()
    const detectedAt = new Date().toISOString()
    return {
      quoteId,
      market: 'US',
      source: 'SEC EDGAR',
      fetchedAt: detectedAt,
      fromCache: false,
      warning: 'SEC 仅用于发现候选披露，不保证包含完整的交易所公司行动日期和券商入账条款。',
      candidates: this.mapCandidates(
        quoteId,
        code,
        issuer.cik,
        submissions.filings?.recent ?? {},
        detectedAt
      ).filter((candidate) => candidate.announcementDate >= periodStart)
    }
  }

  private mapCandidates(
    quoteId: string,
    code: string,
    cik: number,
    recent: SecSubmissionsRecent,
    detectedAt: string
  ): CorporateActionCandidate[] {
    return (recent.accessionNumber ?? []).flatMap((accessionNumber, index) => {
      const form = valueAt(recent.form, index)
      const description = valueAt(recent.primaryDocDescription, index)
      const primaryDocument = valueAt(recent.primaryDocument, index)
      const filingDate = valueAt(recent.filingDate, index)
      const text = `${form} ${description}`
      if (
        !CANDIDATE_FORMS.has(form) ||
        !ACTION_DESCRIPTION.test(text) ||
        !primaryDocument ||
        !filingDate
      ) {
        return []
      }
      const type = classifyCorporateAction(text)
      if (!type) return []
      const url = this.client.filingUrl(cik, accessionNumber, primaryDocument)
      const hash = createHash('sha256')
        .update(`${accessionNumber}|${form}|${description}|${primaryDocument}`)
        .digest('hex')
      const title = description || `${code} ${form} 公司行动候选`
      return [
        {
          id: `sec:${accessionNumber}`,
          quoteId,
          market: 'US' as const,
          type,
          status: 'needsReview' as const,
          title,
          announcementDate: filingDate,
          ...extractCorporateActionDates(text),
          terms: extractCorporateActionTerms(type, text, quoteId),
          evidence: [
            {
              source: 'SEC EDGAR',
              title,
              url,
              publishedAt: `${filingDate}T00:00:00.000Z`,
              excerpt: `${form} · ${description}`
            }
          ],
          providerId: 'sec-edgar',
          providerEventId: accessionNumber,
          contentHash: hash,
          detectedAt,
          warning: '免费 SEC 候选；请以券商通知确认数量、现金、税费及生效日期。'
        }
      ]
    })
  }
}
