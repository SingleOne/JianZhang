import type {
  AiModuleDependencies,
  AiProviderTool,
  AiProviderToolCall,
  AiSourceCitation
} from '../../shared/types'
import type { StockDataManifest, StockDataManifestStock } from '../stock-data/tool'
import { isOfficialStockSourceUrl } from '../official-source'

export const STOCK_INFORMATION_SEARCH_TOOL_NAME = 'search_stock_information'
const DEFAULT_MAX_RESULTS = 8
const MAX_RESULTS = 20
const MAX_REQUESTS = 8

type SearchCategory = AiSourceCitation['category']

interface ParsedSearchRequest {
  stockRef: string
  categories: SearchCategory[]
  keywords: string[]
  startDate?: string
  endDate?: string
  maxResults: number
}

interface SearchItem {
  stockRef: string
  title: string
  source: string
  publishedAt: string
  url: string
  category: SearchCategory
  scope: 'stock' | 'sector' | 'market'
  excerpt?: string
}

interface SearchLoadResult {
  items: SearchItem[]
  warnings: string[]
}

const SEARCH_CATEGORIES: SearchCategory[] = [
  'announcement',
  'company_report',
  'corporate_action',
  'regulation',
  'official_news'
]

export const STOCK_INFORMATION_SEARCH_TOOL: AiProviderTool = {
  name: STOCK_INFORMATION_SEARCH_TOOL_NAME,
  description:
    '检索当前消息已授权股票的官方公开信息，包括公司公告/定期报告/公司行动，以及证监会和沪深北交易所公开信息。港股和美股公司报告分别来自 HKEXnews 和 SEC EDGAR。只能使用股票数据目录中的 stockRef。结果附带消息级唯一的 citationId，回答引用事实时必须原样保留该编号。此工具不是全网或媒体搜索。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['requests'],
    properties: {
      requests: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_REQUESTS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['stockRef'],
          properties: {
            stockRef: { type: 'string', description: '股票数据目录中的 stockRef。' },
            categories: {
              type: 'array',
              uniqueItems: true,
              items: { type: 'string', enum: SEARCH_CATEGORIES },
              description: '省略时检索全部官方信息类别。'
            },
            keywords: {
              type: 'array',
              maxItems: 8,
              items: { type: 'string' },
              description: '标题、来源或摘要必须包含的关键词。'
            },
            startDate: { type: 'string', description: '可选起始日期，格式 YYYY-MM-DD。' },
            endDate: { type: 'string', description: '可选结束日期，格式 YYYY-MM-DD。' },
            maxResults: {
              type: 'integer',
              minimum: 1,
              maximum: MAX_RESULTS,
              description: `每只股票最多返回 ${MAX_RESULTS} 条，默认 ${DEFAULT_MAX_RESULTS} 条。`
            }
          }
        }
      }
    }
  }
}

function parseRequests(raw: string): ParsedSearchRequest[] {
  const input = JSON.parse(raw) as { requests?: unknown[] }
  if (
    !Array.isArray(input.requests) ||
    input.requests.length < 1 ||
    input.requests.length > MAX_REQUESTS
  ) {
    throw new Error(`requests 数量必须为 1-${MAX_REQUESTS}`)
  }
  return input.requests.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`requests[${index}] 必须是对象`)
    }
    const item = value as Record<string, unknown>
    if (typeof item.stockRef !== 'string' || !item.stockRef.trim()) {
      throw new Error(`requests[${index}] 缺少 stockRef`)
    }
    const categories = item.categories ?? SEARCH_CATEGORIES
    if (
      !Array.isArray(categories) ||
      categories.some((category) => !SEARCH_CATEGORIES.includes(category as SearchCategory))
    ) {
      throw new Error(`requests[${index}].categories 不受支持`)
    }
    const keywords = item.keywords ?? []
    if (!Array.isArray(keywords) || keywords.some((keyword) => typeof keyword !== 'string')) {
      throw new Error(`requests[${index}].keywords 必须是字符串数组`)
    }
    for (const field of ['startDate', 'endDate'] as const) {
      const date = item[field]
      if (date !== undefined && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
        throw new Error(`requests[${index}].${field} 必须为 YYYY-MM-DD`)
      }
    }
    const maxResults = item.maxResults ?? DEFAULT_MAX_RESULTS
    if (
      typeof maxResults !== 'number' ||
      !Number.isInteger(maxResults) ||
      maxResults < 1 ||
      maxResults > MAX_RESULTS
    ) {
      throw new Error(`requests[${index}].maxResults 必须是 1-${MAX_RESULTS} 的整数`)
    }
    return {
      stockRef: item.stockRef,
      categories: categories as SearchCategory[],
      keywords: (keywords as string[]).map((keyword) => keyword.trim()).filter(Boolean),
      startDate: item.startDate as string | undefined,
      endDate: item.endDate as string | undefined,
      maxResults
    }
  })
}

function newsLookbackDays(startDate?: string): number {
  if (!startDate) return 365
  return Math.max(
    1,
    Math.ceil((Date.now() - new Date(`${startDate}T00:00:00+08:00`).getTime()) / 86_400_000)
  )
}

function matches(request: ParsedSearchRequest, item: SearchItem): boolean {
  const publishedDate = item.publishedAt.slice(0, 10)
  if (request.startDate && publishedDate < request.startDate) return false
  if (request.endDate && publishedDate > request.endDate) return false
  if (request.keywords.length === 0) return true
  const searchable = `${item.title}\n${item.source}\n${item.excerpt ?? ''}`.toLocaleLowerCase()
  return request.keywords.every((keyword) => searchable.includes(keyword.toLocaleLowerCase()))
}

export class StockInformationSearchSession {
  private readonly citationsByKey = new Map<string, AiSourceCitation>()
  private readonly citationPrefix: string

  constructor(
    private readonly manifest: StockDataManifest,
    private readonly dependencies: AiModuleDependencies
  ) {
    this.citationPrefix = `S${manifest.contextId.split(':').at(-1)?.slice(0, 8) ?? 'source'}`
  }

  citations(): AiSourceCitation[] {
    return [...this.citationsByKey.values()]
  }

  async execute(call: AiProviderToolCall, signal: AbortSignal): Promise<string> {
    if (call.name !== STOCK_INFORMATION_SEARCH_TOOL_NAME) {
      throw new Error(`不支持的工具：${call.name}`)
    }
    const requests = parseRequests(call.arguments)
    const results = await Promise.all(
      requests.map(async (request) => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        const stock = this.manifest.stocks.find((item) => item.stockRef === request.stockRef)
        if (!stock) {
          return { ok: false, stockRef: request.stockRef, error: 'stockRef 不在本条消息授权范围内' }
        }
        const loaded = await this.load(stock, request)
        const seen = new Set<string>()
        const items = loaded.items
          .filter((item) => isOfficialStockSourceUrl(item.url))
          .filter((item) => matches(request, item))
          .sort((left, right) => {
            const scopeRank = { stock: 0, sector: 1, market: 2 }
            return (
              scopeRank[left.scope] - scopeRank[right.scope] ||
              new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime()
            )
          })
          .filter((item) => {
            const key = `${item.url}\n${item.title}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          .slice(0, request.maxResults)
          .map((item) => ({ ...item, citationId: this.recordCitation(item).id }))
        return {
          ok: true,
          stockRef: request.stockRef,
          stock: stock.identity,
          matched: items.length,
          items,
          warnings: loaded.warnings
        }
      })
    )
    return JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), results })
  }

  private async load(
    stock: StockDataManifestStock,
    request: ParsedSearchRequest
  ): Promise<SearchLoadResult> {
    const loaders: Array<Promise<SearchLoadResult>> = []
    if (
      stock.identity.market === 'CN' &&
      request.categories.some((category) =>
        ['announcement', 'regulation', 'official_news'].includes(category)
      )
    ) {
      loaders.push(this.loadOfficialNews(stock, request))
    }
    if (request.categories.includes('company_report')) loaders.push(this.loadCompanyReports(stock))
    if (request.categories.includes('corporate_action')) {
      loaders.push(this.loadCorporateActions(stock))
    }
    const settled = await Promise.allSettled(loaders)
    return settled.reduce<SearchLoadResult>(
      (combined, result) => {
        if (result.status === 'fulfilled') {
          combined.items.push(...result.value.items)
          combined.warnings.push(...result.value.warnings)
        } else {
          combined.warnings.push(
            result.reason instanceof Error ? result.reason.message : '官方来源读取失败'
          )
        }
        return combined
      },
      { items: [], warnings: [] }
    )
  }

  private async loadOfficialNews(
    stock: StockDataManifestStock,
    request: ParsedSearchRequest
  ): Promise<SearchLoadResult> {
    const items = await this.dependencies.searchOfficialStockNews({
      quoteId: stock.identity.quoteId,
      code: stock.identity.code,
      fetchedAt: new Date().toISOString(),
      newsLookbackDays: newsLookbackDays(request.startDate)
    })
    return {
      warnings: [],
      items: items
        .map((item): SearchItem => ({
          stockRef: stock.stockRef,
          title: item.title,
          source: item.source,
          publishedAt: item.publishedAt,
          url: item.url,
          scope: item.scope,
          category:
            item.category === 'announcement'
              ? 'announcement'
              : item.category === 'policy'
                ? 'regulation'
                : 'official_news'
        }))
        .filter((item) => request.categories.includes(item.category))
    }
  }

  private async loadCompanyReports(stock: StockDataManifestStock): Promise<SearchLoadResult> {
    const result = await this.dependencies.getCompanyReports(stock.identity.quoteId)
    return {
      warnings: result.warning ? [result.warning] : [],
      items: result.reports.map((report) => ({
        stockRef: stock.stockRef,
        title: report.title,
        source: report.source ?? result.source,
        publishedAt: report.publishedAt,
        url: report.url,
        category: 'company_report',
        scope: 'stock'
      }))
    }
  }

  private async loadCorporateActions(stock: StockDataManifestStock): Promise<SearchLoadResult> {
    const result = await this.dependencies.listCorporateActions(stock.identity.quoteId)
    return {
      warnings: result.warning ? [result.warning] : [],
      items: result.candidates.flatMap((candidate) =>
        candidate.evidence.map((evidence) => ({
          stockRef: stock.stockRef,
          title: evidence.title || candidate.title,
          source: evidence.source,
          publishedAt: evidence.publishedAt,
          url: evidence.url,
          category: 'corporate_action' as const,
          scope: 'stock' as const,
          excerpt: evidence.excerpt
        }))
      )
    }
  }

  private recordCitation(item: SearchItem): AiSourceCitation {
    const key = `${item.stockRef}\n${item.url}`
    const existing = this.citationsByKey.get(key)
    if (existing) return existing
    const citation: AiSourceCitation = {
      id: `${this.citationPrefix}-${this.citationsByKey.size + 1}`,
      stockRef: item.stockRef,
      title: item.title,
      source: item.source,
      publishedAt: item.publishedAt,
      url: item.url,
      category: item.category
    }
    this.citationsByKey.set(key, citation)
    return citation
  }
}
