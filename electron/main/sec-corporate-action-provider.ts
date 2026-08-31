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
  SecEdgarClient,
  type SecIssuer,
  type SecSubmissions,
  type SecSubmissionsRecent
} from './sec-edgar-client'

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

function normalizeFilingText(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

interface SecCorporateActionClient {
  resolveIssuer(ticker: string): Promise<SecIssuer>
  getSubmissions(cik: number): Promise<SecSubmissions>
  getFilingText(cik: number, accessionNumber: string): Promise<string>
  filingUrl(cik: number, accessionNumber: string, primaryDocument: string): string
  filingTextUrl(cik: number, accessionNumber: string): string
}

function actionExcerpt(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const matched = normalized.match(
    /(?:cash|special|interim|final)\s+dividend|stock\s+split|reverse\s+stock\s+split|rights\s+(?:issue|offering)|merger|acquisition|spin.?off|delisting/i
  )
  if (!matched || matched.index === undefined) return normalized.slice(0, 500)
  const start = Math.max(0, matched.index - 160)
  return normalized.slice(start, start + 500)
}

export class SecCorporateActionProvider implements CorporateActionProvider {
  readonly market = 'US' as const

  constructor(private readonly client: SecCorporateActionClient = new SecEdgarClient()) {}

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
      candidates: await this.mapCandidates(
        quoteId,
        code,
        issuer.cik,
        submissions.filings?.recent ?? {},
        periodStart,
        detectedAt
      )
    }
  }

  private async mapCandidates(
    quoteId: string,
    code: string,
    cik: number,
    recent: SecSubmissionsRecent,
    periodStart: string,
    detectedAt: string
  ): Promise<CorporateActionCandidate[]> {
    const candidates: CorporateActionCandidate[] = []
    for (const [index, accessionNumber] of (recent.accessionNumber ?? []).entries()) {
      const form = valueAt(recent.form, index)
      const description = valueAt(recent.primaryDocDescription, index)
      const primaryDocument = valueAt(recent.primaryDocument, index)
      const filingDate = valueAt(recent.filingDate, index)
      const metadataText = `${form} ${description}`
      if (
        !CANDIDATE_FORMS.has(form) ||
        !primaryDocument ||
        !filingDate ||
        filingDate < periodStart
      ) {
        continue
      }

      let text = metadataText
      let evidenceUrl = this.client.filingUrl(cik, accessionNumber, primaryDocument)
      if (!ACTION_DESCRIPTION.test(metadataText)) {
        try {
          text = `${metadataText} ${normalizeFilingText(await this.client.getFilingText(cik, accessionNumber))}`
          evidenceUrl = this.client.filingTextUrl(cik, accessionNumber)
        } catch {
          continue
        }
      }
      if (!ACTION_DESCRIPTION.test(text)) continue
      const type = classifyCorporateAction(text)
      if (!type) continue
      const hash = createHash('sha256')
        .update(`${accessionNumber}|${form}|${description}|${primaryDocument}|${text}`)
        .digest('hex')
      const title =
        description && description !== form ? description : `${code} ${form} 公司行动候选`
      candidates.push({
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
            url: evidenceUrl,
            publishedAt: `${filingDate}T00:00:00.000Z`,
            excerpt: actionExcerpt(text)
          }
        ],
        providerId: 'sec-edgar',
        providerEventId: accessionNumber,
        contentHash: hash,
        detectedAt,
        warning: '免费 SEC 候选；请以券商通知确认数量、现金、税费及生效日期。'
      })
    }
    return candidates
  }
}
