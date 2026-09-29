import { marketCapabilitiesForQuoteId, marketFromQuoteId } from './stock-market'

export type StockCacheCategoryId =
  | 'klines'
  | 'quotes'
  | 'market-details'
  | 'shareholders'
  | 'valuations'
  | 'market-insight'
  | 'company-reports'
  | 'corporate-actions'
  | 'ai-interpretations'

export interface StockCacheCategory {
  id: StockCacheCategoryId
  label: string
  description: string
}

export interface StockCacheClearResult {
  cleared: StockCacheCategoryId[]
  failed: Array<{ id: StockCacheCategoryId; message: string }>
}

const CATEGORIES: readonly StockCacheCategory[] = [
  { id: 'klines', label: 'K 线与分时', description: '日、周、月 K 线及分时缓存' },
  { id: 'quotes', label: '行情快照', description: '本股最近一次行情快照' },
  {
    id: 'market-details',
    label: '行情明细',
    description: '筹码分布、所属板块、盘口与资金流向'
  },
  { id: 'shareholders', label: '股东数据', description: '本股最近一次股东信息' },
  { id: 'valuations', label: '历史估值', description: '本股 PE、PB 等历史估值序列' },
  { id: 'market-insight', label: '市场观察', description: '本股指标、新闻与观察快照' },
  { id: 'company-reports', label: '官方财报', description: '报告目录和可重新获取的基本面缓存' },
  { id: 'corporate-actions', label: '公司行动候选', description: '候选索引与对应的证据文本' },
  { id: 'ai-interpretations', label: 'AI 解读缓存', description: '本股短期及长期分析结果缓存' }
]

export function stockCacheCategories(quoteId: string): StockCacheCategory[] {
  const capabilities = marketCapabilitiesForQuoteId(quoteId)
  return CATEGORIES.filter(({ id }) => {
    if (id === 'market-details') {
      return (
        capabilities.chipDistribution ||
        capabilities.sector ||
        capabilities.orderBook ||
        capabilities.fundsFlow
      )
    }
    if (id === 'shareholders') return capabilities.shareholders
    if (id === 'valuations') return marketFromQuoteId(quoteId) === 'CN'
    if (id === 'market-insight') return capabilities.marketInsight
    if (id === 'company-reports') return capabilities.companyReports
    if (id === 'corporate-actions') return capabilities.corporateActions
    if (id === 'ai-interpretations') return capabilities.aiAnalysis
    return true
  })
}
