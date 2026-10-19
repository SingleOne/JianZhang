import { BROWSER_USER_AGENT } from '../../../../../electron/main/http-user-agent'
import type { AiMessage, AiProviderTool, AiProviderToolCall } from '../../shared/types'
import { neutralizeHistoricalCitationMarkers } from '../citations/markers'
import { WebSearchSources, webPageUrl } from './sources'

export const MINIMAX_SEARCH_TOOL: AiProviderTool = {
  name: 'search_web',
  description:
    '通过 MiniMax 官方搜索服务查询公开网页，返回标题、链接、摘要和 citationId。不得搜索用户账户、持仓、交易记录或私人资料。此工具不提供网页全文抓取。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: { query: { type: 'string', minLength: 1, maxLength: 128 } }
  }
}

interface MiniMaxSearchResult {
  organic?: Array<{ title: string; link: string; snippet: string; date?: string }>
  base_resp: { status_code: number; status_msg: string }
}

export class MiniMaxSearchSession {
  private readonly sources: WebSearchSources
  private searches = 0

  constructor(
    turnId: string,
    private readonly getApiKey: () => string | undefined,
    private readonly onActivity: (activity: NonNullable<AiMessage['activity']>) => void
  ) {
    this.sources = new WebSearchSources(turnId)
  }

  citations() {
    return this.sources.citations()
  }

  async execute(call: AiProviderToolCall, signal: AbortSignal): Promise<string> {
    this.searches++
    this.onActivity('searching')
    try {
      const apiKey = this.getApiKey()
      if (!apiKey) throw new Error('请先在服务设置中配置具有搜索权限的 MiniMax 订阅 Key')
      const args = JSON.parse(call.arguments) as { query?: string }
      if (typeof args.query !== 'string' || !args.query.trim() || [...args.query].length > 128)
        throw new Error('搜索词必须为 1～128 个字符')
      const response = await fetch('https://api.minimaxi.com/v1/coding_plan/search', {
        method: 'POST',
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          'MM-API-Source': 'Minimax-MCP',
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ q: args.query.trim() })
      })
      if (!response.ok)
        throw new Error(
          `MiniMax 搜索失败（HTTP ${response.status}）。此功能需要具有搜索权限的订阅 Key，普通按量 API Key 不保证可用。`
        )
      const data = (await response.json()) as MiniMaxSearchResult
      if (data.base_resp.status_code !== 0)
        throw new Error(
          `MiniMax 搜索失败：${data.base_resp.status_msg}（${data.base_resp.status_code}）。请确认当前 Key 的订阅搜索权限和额度。`
        )
      const results = (data.organic ?? []).slice(0, 10).flatMap((item) => {
        let url: URL
        try {
          url = webPageUrl(item.link)
        } catch {
          return []
        }
        const summary = neutralizeHistoricalCitationMarkers(item.snippet || '').slice(0, 2000)
        const timestamp = item.date ? Date.parse(item.date) : NaN
        const publishedAt = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
        const citation = this.sources.record(
          url,
          item.title,
          summary,
          'summary',
          undefined,
          publishedAt
        )
        return [
          {
            citationId: citation.id,
            title: citation.title,
            url: citation.url,
            summary,
            publishedAt: citation.publishedAt,
            retrievedAt: citation.retrievedAt,
            evidenceType: 'summary'
          }
        ]
      })
      return JSON.stringify({ ok: true, results })
    } catch (error) {
      if (signal.aborted) throw error
      return JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'MiniMax 搜索失败'
      })
    } finally {
      this.searches--
      this.onActivity(this.searches > 0 ? 'searching' : 'thinking')
    }
  }
}
