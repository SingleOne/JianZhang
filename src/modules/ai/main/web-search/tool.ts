import { BROWSER_USER_AGENT } from '../../../../../electron/main/http-user-agent'
import type { AiMessage, AiProviderTool, AiProviderToolCall, WebCitation } from '../../shared/types'
import { neutralizeHistoricalCitationMarkers } from '../citations/markers'
import { WebSearchSources, webPageUrl } from './sources'

const API_BASE = 'https://api.deepseek.com/v1/tools'
const MAX_RESULTS = 10
const MAX_PAGE_LENGTH = 12_000

export const WEB_SEARCH_TOOLS: AiProviderTool[] = [
  {
    name: 'search_web',
    description:
      '通过 DeepSeek 搜索公开网页，返回标题、链接、摘要、发布时间和 citationId。可用 site:、after:、before: 等搜索语法；需要核对原文时再调用 fetch_webpage。不得搜索用户账户、持仓或私人资料。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 128 },
        count: { type: 'integer', minimum: 1, maximum: MAX_RESULTS, description: '默认 5 条。' }
      }
    }
  },
  {
    name: 'fetch_webpage',
    description:
      '通过 DeepSeek 读取单个公开网页，返回 Markdown 正文和 citationId。用户要求阅读或总结指定链接时直接使用；也可读取搜索结果以核对细节。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: { url: { type: 'string', maxLength: 8192, description: 'HTTP/HTTPS 网页链接。' } }
    }
  }
]

interface SearchResult {
  title: string
  url: string
  snippet: string
  summary: string
  site_name: string | null
  date: string | null
  rerank_score: number
  authority: number
}

const REQUEST_ERRORS: Record<number, string> = {
  400: '网页搜索或抓取的请求参数无效',
  401: 'DeepSeek API Key 无效，请在服务设置中重新配置',
  402: 'DeepSeek 账户余额不足，请充值后重试',
  403: 'DeepSeek 拒绝读取此网页',
  404: '未能取得网页正文，页面可能不可访问或不支持抓取',
  429: 'DeepSeek 网页请求过于频繁，请稍后重试'
}

export class WebSearchSession {
  private readonly sources: WebSearchSources
  private searches = 0
  private fetches = 0

  constructor(
    turnId: string,
    private readonly getApiKey: () => string | undefined,
    private readonly onActivity: (activity: NonNullable<AiMessage['activity']>) => void
  ) {
    this.sources = new WebSearchSources(turnId)
  }

  citations(): WebCitation[] {
    return this.sources.citations()
  }

  async execute(call: AiProviderToolCall, signal: AbortSignal): Promise<string> {
    const searching = call.name === 'search_web'
    if (!searching && call.name !== 'fetch_webpage') throw new Error('不支持的网页工具')
    if (searching) this.searches++
    else this.fetches++
    this.reportActivity()
    try {
      const apiKey = this.getApiKey()
      if (!apiKey) throw new Error('请先在服务设置中配置 DeepSeek API Key，才能搜索或读取网页')
      const args = JSON.parse(call.arguments)
      if (searching) {
        if (typeof args.query !== 'string' || !args.query.trim() || [...args.query].length > 128)
          throw new Error('搜索词必须为 1～128 个字符')
        const count = args.count ?? 5
        if (!Number.isInteger(count) || count < 1 || count > MAX_RESULTS)
          throw new Error(`搜索条数必须为 1～${MAX_RESULTS}`)
        const response = await this.request<{ results: SearchResult[] }>(
          'search',
          { query: args.query.trim(), count, need_content: false },
          apiKey,
          signal
        )
        const results = response.results.slice(0, count).flatMap((item) => {
          let url: URL
          try {
            url = webPageUrl(item.url)
          } catch {
            return []
          }
          const summary = neutralizeHistoricalCitationMarkers(item.summary || item.snippet).slice(
            0,
            2000
          )
          const citation = this.sources.record(
            url,
            item.title,
            summary,
            'summary',
            item.site_name,
            item.date
          )
          return [
            {
              citationId: citation.id,
              title: citation.title,
              url: url.href,
              summary,
              publishedAt: citation.publishedAt,
              source: citation.source,
              retrievedAt: citation.retrievedAt,
              evidenceType: 'summary',
              rerankScore: item.rerank_score,
              authority: item.authority
            }
          ]
        })
        return JSON.stringify({ ok: true, results })
      }
      if (typeof args.url !== 'string') throw new Error('缺少网页链接')
      const url = webPageUrl(args.url)
      const page = await this.request<{ title: string; content: string }>(
        'fetch',
        { url: url.href },
        apiKey,
        signal
      )
      if (!page.content?.trim()) throw new Error('未能取得网页正文')
      const sanitized = neutralizeHistoricalCitationMarkers(page.content)
      const content = sanitized.slice(0, MAX_PAGE_LENGTH)
      const citation = this.sources.record(url, page.title, content, 'content')
      return JSON.stringify({
        ok: true,
        citationId: citation.id,
        title: citation.title,
        url: url.href,
        content,
        truncated: content.length < sanitized.length,
        publishedAt: citation.publishedAt,
        retrievedAt: citation.retrievedAt,
        evidenceType: 'content'
      })
    } catch (error) {
      if (signal.aborted) throw error
      return JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : '网页请求失败'
      })
    } finally {
      if (searching) this.searches--
      else this.fetches--
      this.reportActivity()
    }
  }

  private async request<T>(
    endpoint: 'search' | 'fetch',
    body: object,
    apiKey: string,
    signal: AbortSignal
  ): Promise<T> {
    const response = await fetch(`${API_BASE}/${endpoint}`, {
      method: 'POST',
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': BROWSER_USER_AGENT
      },
      body: JSON.stringify(body)
    })
    if (!response.ok)
      throw new Error(
        REQUEST_ERRORS[response.status] ??
          `DeepSeek 网页请求失败（HTTP ${response.status}），请稍后重试`
      )
    return response.json() as Promise<T>
  }

  private reportActivity(): void {
    this.onActivity(this.fetches > 0 ? 'fetching' : this.searches > 0 ? 'searching' : 'thinking')
  }
}
