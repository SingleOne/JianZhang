import type { MarketNewsItem } from '../../shared/types'

export interface NewsQuery {
  quoteId: string
  code: string
  sectorQuoteId?: string
  fetchedAt: string
}

export interface MarketNewsProvider {
  id: string
  fetchStockNews: (input: NewsQuery) => Promise<MarketNewsItem[]>
  fetchSectorNews: (input: NewsQuery) => Promise<MarketNewsItem[]>
  fetchMarketNews: (input: NewsQuery) => Promise<MarketNewsItem[]>
}
