import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { net, shell } from 'electron'
import pdfParse from 'pdf-parse'
import {
  extractCorporateActionDates,
  extractCorporateActionTerms
} from '../../src/lib/corporate-actions'
import { previewCorporateAction, reversalEntries } from '../../src/lib/portfolio-ledger'
import { marketFromQuoteId } from '../../src/shared/stock-market'
import type {
  AiStructuredTaskRequest,
  AiStructuredTaskResult
} from '../../src/modules/ai/shared/types'
import type {
  CorporateActionCandidate,
  CorporateActionImpactPreview,
  CorporateActionListResult,
  CorporateActionPreviewRequest,
  CorporateActionRecord,
  CorporateActionSummary,
  CorporateActionTerms,
  ManualCorporateActionRequest,
  StockMarket,
  TTradingAccount
} from '../../src/shared/types'
import { atomicWriteJsonSync } from './file-storage'
import type { CorporateActionProvider } from './corporate-action-provider'
import { HkexCorporateActionProvider } from './hkex-corporate-action-provider'
import { SecCorporateActionProvider } from './sec-corporate-action-provider'
import { SEC_DOCUMENT_HEADERS, SecEdgarClient } from './sec-edgar-client'

const CACHE_MAX_AGE = 24 * 60 * 60 * 1000
const CACHE_VERSION = 2
const OFFICIAL_HOSTS = new Set(['www1.hkexnews.hk', 'www.hkexnews.hk', 'www.sec.gov', 'sec.gov'])
const SUMMARY_PROMPT = `你是上市公司行动摘要助手。只能依据用户提供的公司行动候选、已提取条款和官方证据摘录，不得补充外部信息或猜测未披露内容。

请用 120—260 字中文纯文本说明：行动是什么、关键日期和执行条款、对股东持仓数量/成本/现金流可能产生的影响，以及仍需向券商或官方原文核对的不确定项。
不得使用 Markdown、标题或列表，不得给出买卖建议、目标价或收益承诺。证据不足时必须明确说明资料不足。`

type RunStructuredTask = (
  request: AiStructuredTaskRequest,
  signal: AbortSignal
) => Promise<AiStructuredTaskResult>

function normalizeSummaryContent(value: string): string {
  const content = value
    .trim()
    .replace(/^```(?:text)?\s*|\s*```$/g, '')
    .replace(/^\s*(?:#{1,6}|[-*+]|\d+[.)])\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!content) throw new Error('AI 未返回公司行动总结')
  if (
    /(?:建议|应当|可以考虑)(?:立即|择机)?(?:买入|卖出|增持|减持)|目标价|保证(?:收益|回报)|收益承诺/.test(
      content
    )
  ) {
    throw new Error('AI 总结包含不允许的交易建议，请重新生成')
  }
  return content.slice(0, 600)
}

function mergeExtractedField<T>(
  original: { value?: T; confidence: 'high' | 'medium' | 'low'; evidenceText?: string },
  extracted: { value?: T; confidence: 'high' | 'medium' | 'low'; evidenceText?: string }
) {
  return extracted.value === undefined ? original : extracted
}

function mergeTerms(
  original: CorporateActionTerms,
  extracted: CorporateActionTerms
): CorporateActionTerms {
  if (original.kind !== extracted.kind)
    return extracted.kind === 'unsupported' ? original : extracted
  if (original.kind === 'cashDividend' && extracted.kind === 'cashDividend') {
    return {
      kind: 'cashDividend',
      amountPerShare: mergeExtractedField(original.amountPerShare, extracted.amountPerShare),
      currency: mergeExtractedField(original.currency, extracted.currency)
    }
  }
  if (original.kind === 'shareRatio' && extracted.kind === 'shareRatio') {
    return {
      kind: 'shareRatio',
      oldShares: mergeExtractedField(original.oldShares, extracted.oldShares),
      newShares: mergeExtractedField(original.newShares, extracted.newShares),
      fractionalTreatment: extracted.fractionalTreatment ?? original.fractionalTreatment
    }
  }
  if (original.kind === 'rightsIssue' && extracted.kind === 'rightsIssue') {
    return {
      kind: 'rightsIssue',
      heldShares: mergeExtractedField(original.heldShares, extracted.heldShares),
      entitlementShares: mergeExtractedField(
        original.entitlementShares,
        extracted.entitlementShares
      ),
      subscriptionPrice: mergeExtractedField(
        original.subscriptionPrice,
        extracted.subscriptionPrice
      ),
      currency: mergeExtractedField(original.currency, extracted.currency)
    }
  }
  if (original.kind === 'securityConversion' && extracted.kind === 'securityConversion') {
    return {
      kind: 'securityConversion',
      oldShares: mergeExtractedField(original.oldShares, extracted.oldShares),
      newShares: mergeExtractedField(original.newShares, extracted.newShares),
      targetQuoteId: extracted.targetQuoteId ?? original.targetQuoteId
    }
  }
  return original
}

export class CorporateActionService {
  private readonly cacheDirectory: string
  private readonly providers: Partial<Record<StockMarket, CorporateActionProvider>>
  private readonly inFlight = new Map<string, Promise<CorporateActionListResult>>()

  constructor(userDataDirectory: string, secClient = new SecEdgarClient()) {
    this.cacheDirectory = join(userDataDirectory, 'corporate-actions', 'candidates')
    this.providers = {
      HK: new HkexCorporateActionProvider(),
      US: new SecCorporateActionProvider(secClient)
    }
  }

  async get(quoteId: string, forceRefresh = false): Promise<CorporateActionListResult> {
    const pending = this.inFlight.get(quoteId)
    if (pending) return pending
    const request = this.fetch(quoteId, forceRefresh)
    this.inFlight.set(quoteId, request)
    try {
      return await request
    } finally {
      if (this.inFlight.get(quoteId) === request) this.inFlight.delete(quoteId)
    }
  }

  private async fetch(quoteId: string, forceRefresh: boolean): Promise<CorporateActionListResult> {
    const market = marketFromQuoteId(quoteId)
    const provider = this.providers[market]
    if (!provider) {
      return this.attachSummaries({
        quoteId,
        market,
        source: '暂无可用官方来源',
        fetchedAt: new Date().toISOString(),
        fromCache: false,
        candidates: []
      })
    }
    const storedCache = this.readCache(quoteId, market)
    const cached = storedCache?.cacheVersion === CACHE_VERSION ? storedCache : null
    if (
      !forceRefresh &&
      cached &&
      Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_MAX_AGE
    ) {
      return this.attachSummaries({ ...cached, fromCache: true })
    }
    try {
      const fetched = await provider.fetch(quoteId)
      const candidates = fetched.candidates.map((candidate) => {
        const previous = cached?.candidates.find(
          (item) =>
            item.providerId === candidate.providerId &&
            item.providerEventId === candidate.providerEventId
        )
        return previous && previous.contentHash !== candidate.contentHash
          ? { ...candidate, status: 'revised' as const }
          : candidate
      })
      const result = { ...fetched, candidates, cacheVersion: CACHE_VERSION }
      this.writeCache(result)
      return this.attachSummaries(result)
    } catch (reason) {
      if (!cached) throw reason
      return this.attachSummaries({
        ...cached,
        fromCache: true,
        degraded: true,
        warning: `在线更新失败，当前显示本地缓存：${reason instanceof Error ? reason.message : '未知错误'}`
      })
    }
  }

  async generateSummary(
    candidate: CorporateActionCandidate,
    runStructuredTask: RunStructuredTask
  ): Promise<CorporateActionSummary> {
    const enrichedCandidate = await this.enrichCandidate(candidate)
    const result = await runStructuredTask(
      {
        systemPrompt: SUMMARY_PROMPT,
        userContent: JSON.stringify({
          quoteId: enrichedCandidate.quoteId,
          market: enrichedCandidate.market,
          type: enrichedCandidate.type,
          title: enrichedCandidate.title,
          status: enrichedCandidate.status,
          announcementDate: enrichedCandidate.announcementDate,
          exDate: enrichedCandidate.exDate,
          recordDate: enrichedCandidate.recordDate,
          electionDeadline: enrichedCandidate.electionDeadline,
          effectiveDate: enrichedCandidate.effectiveDate,
          payableDate: enrichedCandidate.payableDate,
          terms: enrichedCandidate.terms,
          warning: enrichedCandidate.warning,
          evidence: enrichedCandidate.evidence.map((item) => ({
            source: item.source,
            title: item.title,
            publishedAt: item.publishedAt,
            excerpt: item.excerpt
          }))
        })
      },
      AbortSignal.timeout(180_000)
    )
    const content = normalizeSummaryContent(result.content)
    const summary: CorporateActionSummary = {
      candidateId: candidate.id,
      quoteId: candidate.quoteId,
      contentHash: candidate.contentHash,
      content,
      generatedAt: new Date().toISOString(),
      providerId: result.providerId,
      model: result.model
    }
    const summaries = this.readSummaries()
    summaries[candidate.id] = summary
    this.writeSummaries(summaries)
    return summary
  }

  async preview(request: CorporateActionPreviewRequest): Promise<CorporateActionImpactPreview> {
    const candidate = await this.enrichCandidate(request.candidate)
    return {
      ...previewCorporateAction(candidate, request.account, request.confirmation),
      resolvedCandidate: candidate
    }
  }

  ignore(candidate: CorporateActionCandidate): CorporateActionRecord {
    return {
      ...candidate,
      status: 'ignored',
      reviewedAt: new Date().toISOString()
    }
  }

  reverse(candidate: CorporateActionCandidate, account: TTradingAccount) {
    return reversalEntries(candidate, account)
  }

  createManual(
    request: ManualCorporateActionRequest,
    account: TTradingAccount
  ): { candidate: CorporateActionCandidate; preview: CorporateActionImpactPreview } {
    const id = `manual:${randomUUID()}`
    const candidate: CorporateActionCandidate = {
      id,
      quoteId: request.quoteId,
      market: request.market,
      type: request.type,
      status: 'needsReview',
      title: request.title,
      announcementDate: request.announcementDate,
      effectiveDate: request.effectiveDate,
      terms: request.type === 'manualCash' ? { kind: 'manualCash' } : { kind: 'unsupported' },
      evidence: [],
      providerId: 'manual',
      providerEventId: id,
      contentHash: id,
      detectedAt: new Date().toISOString()
    }
    return {
      candidate,
      preview: previewCorporateAction(candidate, account, {
        ...request.confirmation,
        currency: request.currency
      })
    }
  }

  async open(url: string): Promise<void> {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !OFFICIAL_HOSTS.has(parsed.hostname)) {
      throw new Error('只能打开受支持交易所或监管机构的官方公司行动原文')
    }
    await shell.openExternal(url)
  }

  async refreshWatchlist(quoteIds: readonly string[]): Promise<void> {
    for (const quoteId of quoteIds) {
      if (marketFromQuoteId(quoteId) === 'CN') continue
      try {
        await this.get(quoteId)
      } catch {
        // 后台低频检查失败不影响行情与应用启动。
      }
    }
  }

  private cachePath(quoteId: string, market: StockMarket): string {
    return join(this.cacheDirectory, market, `${quoteId.replace(/[^\w.-]/g, '_')}.json`)
  }

  private summariesPath(): string {
    return join(this.cacheDirectory, '..', 'summaries.json')
  }

  private documentPath(candidate: CorporateActionCandidate): string {
    return join(
      this.cacheDirectory,
      '..',
      'documents',
      `${candidate.providerId}-${candidate.providerEventId.replace(/[^\w.-]/g, '_')}.json`
    )
  }

  private async enrichCandidate(
    candidate: CorporateActionCandidate
  ): Promise<CorporateActionCandidate> {
    if (candidate.providerId === 'manual' || candidate.evidence.length === 0) return candidate
    const path = this.documentPath(candidate)
    let text = ''
    if (existsSync(path)) {
      const cached = JSON.parse(readFileSync(path, 'utf8')) as {
        sourceHash: string
        text: string
      }
      if (cached.sourceHash === candidate.contentHash) text = cached.text
    }
    if (!text) {
      const url = candidate.evidence[0].url
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' || !OFFICIAL_HOSTS.has(parsed.hostname)) return candidate
      try {
        const response = await net.fetch(url, {
          headers:
            candidate.market === 'HK'
              ? {
                  Referer: 'https://www1.hkexnews.hk/',
                  'User-Agent': 'JianZhang Desktop stock research app'
                }
              : { ...SEC_DOCUMENT_HEADERS, Referer: 'https://www.sec.gov/' },
          signal: AbortSignal.timeout(45_000)
        })
        if (!response.ok) return candidate
        const buffer = Buffer.from(await response.arrayBuffer())
        text = parsed.pathname.toLowerCase().endsWith('.pdf')
          ? (await pdfParse(buffer)).text
          : this.extractHtmlText(buffer.toString('utf8'))
        text = text.replace(/\s+/g, ' ').trim().slice(0, 300_000)
        mkdirSync(join(this.cacheDirectory, '..', 'documents'), { recursive: true })
        atomicWriteJsonSync(path, {
          sourceHash: candidate.contentHash,
          fetchedAt: new Date().toISOString(),
          text
        })
      } catch {
        return candidate
      }
    }
    if (!text) return candidate
    const dates = extractCorporateActionDates(text)
    const extractedTerms = extractCorporateActionTerms(candidate.type, text, candidate.quoteId)
    return {
      ...candidate,
      exDate: dates.exDate ?? candidate.exDate,
      recordDate: dates.recordDate ?? candidate.recordDate,
      payableDate: dates.payableDate ?? candidate.payableDate,
      effectiveDate: dates.effectiveDate ?? candidate.effectiveDate,
      electionDeadline: dates.electionDeadline ?? candidate.electionDeadline,
      terms: mergeTerms(candidate.terms, extractedTerms),
      evidence: candidate.evidence.map((evidence, index) =>
        index === 0
          ? { ...evidence, excerpt: evidence.excerpt?.trim() || text.slice(0, 2_000) }
          : evidence
      )
    }
  }

  private extractHtmlText(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
  }

  private readCache(quoteId: string, market: StockMarket): CorporateActionListResult | null {
    const path = this.cachePath(quoteId, market)
    return existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf8')) as CorporateActionListResult)
      : null
  }

  private attachSummaries(result: CorporateActionListResult): CorporateActionListResult {
    const summaries = this.readSummaries()
    return {
      ...result,
      candidates: result.candidates.map((candidate) => {
        const summary = summaries[candidate.id]
        return summary?.contentHash === candidate.contentHash
          ? { ...candidate, aiSummary: summary }
          : candidate
      })
    }
  }

  private readSummaries(): Record<string, CorporateActionSummary> {
    const path = this.summariesPath()
    return existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, CorporateActionSummary>)
      : {}
  }

  private writeSummaries(summaries: Record<string, CorporateActionSummary>): void {
    mkdirSync(join(this.cacheDirectory, '..'), { recursive: true })
    atomicWriteJsonSync(this.summariesPath(), summaries)
  }

  private writeCache(result: CorporateActionListResult): void {
    const path = this.cachePath(result.quoteId, result.market)
    mkdirSync(join(this.cacheDirectory, result.market), { recursive: true })
    atomicWriteJsonSync(path, result)
  }
}
