import type { MarketNewsItem } from '../../shared/types'

export interface NewsQuery {
  quoteId: string
  code: string
  sectorQuoteId?: string
  fetchedAt: string
  newsLookbackDays: number
}

export interface MarketNewsProvider {
  id: string
  name: string
  fetchStockNews: (input: NewsQuery) => Promise<MarketNewsItem[]>
  fetchSectorNews: (input: NewsQuery) => Promise<MarketNewsItem[]>
  fetchMarketNews: (input: NewsQuery) => Promise<MarketNewsItem[]>
}

export interface NewsSourceFailure {
  source: string
  message: string
}

export interface NewsFetchResult {
  items: MarketNewsItem[]
  failures: NewsSourceFailure[]
  refreshed: boolean
}
