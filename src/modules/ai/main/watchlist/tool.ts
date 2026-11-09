import type { AiModuleDependencies, AiProviderTool, AiProviderToolCall } from '../../shared/types'

export const ADD_WATCHLIST_STOCK_TOOL: AiProviderTool = {
  name: 'add_watchlist_stock',
  description:
    '按股票名称或代码查找并添加自选股，可根据对话需要自主调用。只支持添加，已存在的股票保持原样。多个候选无法唯一匹配时返回 candidates，使用相同 query 和选中候选的 quoteId 再次调用。无需开启联网搜索。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1, description: '股票名称或代码。' },
      quoteId: {
        type: 'string',
        description: '可选，仅用于从本工具返回的 candidates 中选择确切股票。'
      }
    }
  }
}

export async function executeAddWatchlistStock(
  call: AiProviderToolCall,
  signal: AbortSignal,
  dependencies: Pick<AiModuleDependencies, 'searchStocks' | 'addWatchlistStock'>
): Promise<string> {
  try {
    if (call.name !== ADD_WATCHLIST_STOCK_TOOL.name) throw new Error('不支持的自选股工具')
    const args = JSON.parse(call.arguments) as { query?: unknown; quoteId?: unknown }
    if (typeof args.query !== 'string' || !args.query.trim()) {
      throw new Error('请提供股票名称或代码')
    }
    if (args.quoteId !== undefined && (typeof args.quoteId !== 'string' || !args.quoteId.trim())) {
      throw new Error('quoteId 必须为候选股票的标识')
    }
    if (signal.aborted) throw new DOMException('已停止生成', 'AbortError')
    const query = args.query.trim()
    const candidates = await dependencies.searchStocks(query)
    if (signal.aborted) throw new DOMException('已停止生成', 'AbortError')
    const matching = args.quoteId
      ? candidates.filter((stock) => stock.quoteId === args.quoteId)
      : candidates.filter(
          (stock) =>
            stock.code.toLocaleLowerCase() === query.toLocaleLowerCase() || stock.name === query
        )
    const selected = matching.length === 1 ? matching[0] : undefined
    const stock = selected ?? (!args.quoteId && candidates.length === 1 ? candidates[0] : undefined)
    if (!stock) {
      return JSON.stringify({
        ok: false,
        status: candidates.length ? 'needs_selection' : 'not_found',
        message: candidates.length
          ? '请根据股票名称、代码和市场选择候选，并使用相同 query 及对应 quoteId 再次调用。'
          : '没有找到支持的股票，请核对名称或代码。',
        candidates
      })
    }
    const result = dependencies.addWatchlistStock(stock)
    return JSON.stringify({
      ok: true,
      status: result.added ? 'added' : 'already_exists',
      stock,
      message: result.added ? '已添加到自选股' : '该股票已在自选股中'
    })
  } catch (error) {
    if (signal.aborted) throw error
    return JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : '添加自选股失败'
    })
  }
}
