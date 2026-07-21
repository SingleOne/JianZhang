import { app, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import type { AppState, FundsFlowResult, KlineResult, StockOrderBook, StockQuote } from '../../../shared/types'
import { MARKET_INSIGHT_IPC } from '../shared/constants'
import type { MarketInsightSettings } from '../shared/types'
import { normalizeMarketInsightSettings } from '../shared/normalize'
import { MarketNewsRegistry } from './news/registry'
import { CninfoAnnouncementProvider } from './news/providers/cninfo'
import {
  BseNoticeProvider,
  CsrcNewsProvider,
  SseNoticeProvider,
  SzseNoticeProvider
} from './news/providers/official-market'
import { MarketInsightService } from './service'
import { MarketInsightStorage } from './storage'

export interface MarketDataHub {
  subscribe: (listener: (quotes: readonly StockQuote[]) => void) => () => void
}

export interface MarketInsightDependencies {
  marketDataHub: MarketDataHub
  getState: () => AppState
  getKline: (quoteId: string, period: 'intraday' | 'daily', limit?: number) => Promise<KlineResult>
  getOrderBook: (quoteId: string) => Promise<StockOrderBook>
  getFundsFlow: (quoteId: string) => Promise<FundsFlowResult>
  notifyUpdated: (quoteId: string) => void
}

export interface MarketInsightRuntime {
  dispose: () => void
  getSnapshot: (quoteId: string) => ReturnType<MarketInsightService['getSnapshot']>
  refreshSnapshot: (quoteId: string) => ReturnType<MarketInsightService['refresh']>
}

export function installMarketInsight(dependencies: MarketInsightDependencies): MarketInsightRuntime {
  const storage = new MarketInsightStorage(join(app.getPath('userData'), 'modules', 'market-insight'))
  const service = new MarketInsightService(storage, new MarketNewsRegistry([
    new CninfoAnnouncementProvider(),
    new CsrcNewsProvider(),
    new SseNoticeProvider(),
    new SzseNoticeProvider(),
    new BseNoticeProvider()
  ]), {
    getState: dependencies.getState,
    getKline: dependencies.getKline,
    getOrderBook: dependencies.getOrderBook,
    getFundsFlow: dependencies.getFundsFlow,
    onUpdated: dependencies.notifyUpdated
  })
  const unsubscribe = dependencies.marketDataHub.subscribe((quotes) => service.onMarketDataUpdated(quotes))

  ipcMain.handle(MARKET_INSIGHT_IPC.statusGet, () => service.getStatus())
  ipcMain.handle(MARKET_INSIGHT_IPC.settingsGet, () => service.getSettings())
  ipcMain.handle(MARKET_INSIGHT_IPC.settingsSave, (_event, settings: MarketInsightSettings) => {
    service.saveSettings(normalizeMarketInsightSettings(settings))
  })
  ipcMain.handle(MARKET_INSIGHT_IPC.snapshotGet, (_event, quoteId: string) => service.getSnapshot(quoteId))
  ipcMain.handle(MARKET_INSIGHT_IPC.refresh, (_event, quoteId: string) => service.refresh(quoteId, true))
  ipcMain.handle(MARKET_INSIGHT_IPC.eventsList, (_event, quoteId: string) => service.listEvents(quoteId))
  ipcMain.handle(MARKET_INSIGHT_IPC.eventAcknowledge, (_event, eventId: string) => service.acknowledgeEvent(eventId))
  ipcMain.handle(MARKET_INSIGHT_IPC.eventsClearExpired, (_event, quoteId: string) => service.clearExpiredEvents(quoteId))
  ipcMain.handle(MARKET_INSIGHT_IPC.sourceOpen, (_event, url: string) => {
    const protocol = new URL(url).protocol
    if (protocol !== 'https:' && protocol !== 'http:') throw new Error('仅支持打开 HTTP 或 HTTPS 原始来源')
    return shell.openExternal(url)
  })

  return {
    getSnapshot: (quoteId) => service.getSnapshot(quoteId),
    refreshSnapshot: (quoteId) => service.refresh(quoteId, true),
    dispose: () => {
      unsubscribe()
      service.dispose()
      ipcMain.removeHandler(MARKET_INSIGHT_IPC.statusGet)
      ipcMain.removeHandler(MARKET_INSIGHT_IPC.settingsGet)
      ipcMain.removeHandler(MARKET_INSIGHT_IPC.settingsSave)
      ipcMain.removeHandler(MARKET_INSIGHT_IPC.snapshotGet)
      ipcMain.removeHandler(MARKET_INSIGHT_IPC.refresh)
      ipcMain.removeHandler(MARKET_INSIGHT_IPC.eventsList)
      ipcMain.removeHandler(MARKET_INSIGHT_IPC.eventAcknowledge)
      ipcMain.removeHandler(MARKET_INSIGHT_IPC.eventsClearExpired)
      ipcMain.removeHandler(MARKET_INSIGHT_IPC.sourceOpen)
    }
  }
}
