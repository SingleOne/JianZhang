import { createHash } from 'node:crypto'
import {
  classifyCorporateAction,
  extractCorporateActionDates,
  extractCorporateActionTerms
} from '../../src/lib/corporate-actions'
import type {
  CorporateActionCandidate,
  CorporateActionListResult,
  CorporateActionType
} from '../../src/shared/types'
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
const ACTION_PHRASE =
  /return of capital|capital distribution|reverse stock split|share consolidation|consolidation of shares|stock split|share subdivision|subdivision of shares|rights issue|rights offering|open offer|bonus issue|bonus shares|stock dividend|scrip dividend|capitali[sz]ation issue|cash dividend|special dividend|interim dividend|final dividend|distribution per share|change of.{0,80}(?:stock code|ticker|company name)|symbol change|name change|spin.?off|demerger|merger|scheme of arrangement|security conversion|conversion of securities|delisting|withdrawal of listing|privati[sz]ation|cancellation of listing/gi
const EVENT_SIGNAL =
  /\b(?:declare[ds]?|announce[ds]?|approve[ds]?|authori[sz]e[ds]?|enter(?:ed|s)? into|agree[ds]? to|intend(?:ed|s)? to|plan(?:ned|s)? to|propose[ds]?|complete[ds]?|effect(?:ed|s)?|commence[ds]?|will (?:pay|effect|merge|acquire|distribute))\b/i
const NEGATED_ACTION =
  /\b(?:never|not|no)\b[^.]{0,120}(?:dividend|distribution|split|rights|merger|spin.?off|delisting|capital return)/i
const HISTORICAL_ACTION =
  /\b(?:previously|historically|formerly|in prior years?|during (?:the )?year ended|for (?:the )?year ended)\b/i
const BODY_FETCH_CONCURRENCY = 3
const SEC_WARNING = 'SEC 仅用于发现候选披露，不保证包含完整的交易所公司行动日期和券商入账条款。'

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

function failureReason(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

async function mapInBatches<T, R>(
  items: T[],
  batchSize: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  for (let index = 0; index < items.length; index += batchSize) {
    results.push(...(await Promise.all(items.slice(index, index + batchSize).map(mapper))))
  }
  return results
}

interface SecCorporateActionClient {
  resolveIssuer(ticker: string): Promise<SecIssuer>
  getSubmissions(cik: number): Promise<SecSubmissions>
  getFilingText(cik: number, accessionNumber: string): Promise<string>
  filingUrl(cik: number, accessionNumber: string, primaryDocument: string): string
  filingTextUrl(cik: number, accessionNumber: string): string
}

interface SecFilingMetadata {
  accessionNumber: string
  form: string
  description: string
  primaryDocument: string
  filingDate: string
  metadataText: string
}

interface ActionEvidence {
  text: string
  type: CorporateActionType
}

interface FilingScanResult {
  candidate?: CorporateActionCandidate
  bodyRequested: boolean
  failure?: string
}

interface CandidateMapResult {
  candidates: CorporateActionCandidate[]
  bodyRequests: number
  bodyFailures: string[]
}

function isHistoricalAction(text: string, filingDate: string): boolean {
  if (HISTORICAL_ACTION.test(text)) return true
  const filingYear = Number(filingDate.slice(0, 4))
  if (!Number.isFinite(filingYear)) return false
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((matched) => Number(matched[1]))
  return years.some((year) => year < filingYear - 1)
}

function findActionEvidence(
  text: string,
  requireEventSignal: boolean,
  filingDate: string
): ActionEvidence | null {
  const normalized = normalizeFilingText(text)
  const matches = new RegExp(ACTION_PHRASE.source, ACTION_PHRASE.flags)
  let matched: RegExpExecArray | null
  while ((matched = matches.exec(normalized)) !== null) {
    const type = classifyCorporateAction(matched[0])
    if (!type) continue
    const previousSentenceEnd = normalized.lastIndexOf('. ', matched.index)
    const nextSentenceEnd = normalized.indexOf('. ', matched.index + matched[0].length)
    const actionSentence = normalized.slice(
      previousSentenceEnd < 0 ? Math.max(0, matched.index - 180) : previousSentenceEnd + 2,
      nextSentenceEnd < 0
        ? Math.min(normalized.length, matched.index + matched[0].length + 520)
        : nextSentenceEnd + 1
    )
    if (
      requireEventSignal &&
      (!EVENT_SIGNAL.test(actionSentence) ||
        NEGATED_ACTION.test(actionSentence) ||
        isHistoricalAction(actionSentence, filingDate))
    ) {
      continue
    }
    const excerptStart = Math.max(0, matched.index - 220)
    return {
      type,
      text: normalized.slice(excerptStart, Math.min(normalized.length, excerptStart + 900))
    }
  }
  return null
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
    const mapped = await this.mapCandidates(
      quoteId,
      code,
      issuer.cik,
      submissions.filings?.recent ?? {},
      periodStart,
      detectedAt
    )
    if (
      mapped.candidates.length === 0 &&
      mapped.bodyRequests > 0 &&
      mapped.bodyFailures.length === mapped.bodyRequests
    ) {
      throw new Error(`SEC 披露正文全部获取失败：${mapped.bodyFailures.slice(0, 3).join('；')}`)
    }
    const degraded = mapped.bodyFailures.length > 0
    const bodyWarning = degraded
      ? `；${mapped.bodyFailures.length}/${mapped.bodyRequests} 份候选披露正文获取失败，结果可能不完整：${mapped.bodyFailures
          .slice(0, 3)
          .join('；')}`
      : ''
    return {
      quoteId,
      market: 'US',
      source: 'SEC EDGAR',
      fetchedAt: detectedAt,
      fromCache: false,
      degraded,
      warning: `${SEC_WARNING}${bodyWarning}`,
      candidates: mapped.candidates
    }
  }

  private async mapCandidates(
    quoteId: string,
    code: string,
    cik: number,
    recent: SecSubmissionsRecent,
    periodStart: string,
    detectedAt: string
  ): Promise<CandidateMapResult> {
    const filings = (recent.accessionNumber ?? []).flatMap(
      (accessionNumber, index): SecFilingMetadata[] => {
        const form = valueAt(recent.form, index)
        const description = valueAt(recent.primaryDocDescription, index)
        const primaryDocument = valueAt(recent.primaryDocument, index)
        const filingDate = valueAt(recent.filingDate, index)
        if (
          !CANDIDATE_FORMS.has(form) ||
          !primaryDocument ||
          !filingDate ||
          filingDate < periodStart
        ) {
          return []
        }
        return [
          {
            accessionNumber,
            form,
            description,
            primaryDocument,
            filingDate,
            metadataText: `${form} ${description}`
          }
        ]
      }
    )
    const scans = await mapInBatches(filings, BODY_FETCH_CONCURRENCY, (filing) =>
      this.scanFiling(quoteId, code, cik, filing, detectedAt)
    )
    return {
      candidates: scans.flatMap(({ candidate }) => (candidate ? [candidate] : [])),
      bodyRequests: scans.filter(({ bodyRequested }) => bodyRequested).length,
      bodyFailures: scans.flatMap(({ failure }) => (failure ? [failure] : []))
    }
  }

  private async scanFiling(
    quoteId: string,
    code: string,
    cik: number,
    filing: SecFilingMetadata,
    detectedAt: string
  ): Promise<FilingScanResult> {
    const metadataEvidence = findActionEvidence(filing.metadataText, false, filing.filingDate)
    if (metadataEvidence) {
      return {
        bodyRequested: false,
        candidate: this.createCandidate(
          quoteId,
          code,
          filing,
          metadataEvidence,
          this.client.filingUrl(cik, filing.accessionNumber, filing.primaryDocument),
          detectedAt
        )
      }
    }
    try {
      const filingText = await this.client.getFilingText(cik, filing.accessionNumber)
      const evidence = findActionEvidence(filingText, true, filing.filingDate)
      return {
        bodyRequested: true,
        candidate: evidence
          ? this.createCandidate(
              quoteId,
              code,
              filing,
              evidence,
              this.client.filingTextUrl(cik, filing.accessionNumber),
              detectedAt
            )
          : undefined
      }
    } catch (reason) {
      return {
        bodyRequested: true,
        failure: `${filing.accessionNumber}：${failureReason(reason)}`
      }
    }
  }

  private createCandidate(
    quoteId: string,
    code: string,
    filing: SecFilingMetadata,
    evidence: ActionEvidence,
    evidenceUrl: string,
    detectedAt: string
  ): CorporateActionCandidate {
    const hash = createHash('sha256')
      .update(
        `${filing.accessionNumber}|${filing.form}|${filing.description}|${filing.primaryDocument}|${evidence.text}`
      )
      .digest('hex')
    const title =
      filing.description && filing.description !== filing.form
        ? filing.description
        : `${code} ${filing.form} 公司行动候选`
    return {
      id: `sec:${filing.accessionNumber}`,
      quoteId,
      market: 'US',
      type: evidence.type,
      status: 'needsReview',
      title,
      announcementDate: filing.filingDate,
      ...extractCorporateActionDates(evidence.text),
      terms: extractCorporateActionTerms(evidence.type, evidence.text, quoteId),
      evidence: [
        {
          source: 'SEC EDGAR',
          title,
          url: evidenceUrl,
          publishedAt: `${filing.filingDate}T00:00:00.000Z`,
          excerpt: evidence.text
        }
      ],
      providerId: 'sec-edgar',
      providerEventId: filing.accessionNumber,
      contentHash: hash,
      detectedAt,
      warning: '免费 SEC 候选；请以券商通知确认数量、现金、税费及生效日期。'
    }
  }
}
