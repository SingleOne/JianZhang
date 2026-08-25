import { beijingDateKey } from '../../src/shared/market-hours'
import {
  normalizeExchangeRateSettings,
  type AppState,
  type ExchangeRateSettings
} from '../../src/shared/types'
import type { MarketRequestLogger } from './market-request-logger'
import { fetchSafeExchangeRates } from './exchange-rate'

interface ExchangeRateRuntimeDependencies {
  getState: () => AppState
  saveState: (state: AppState) => void
  marketRequestLogger: MarketRequestLogger
}

function beijingMinutes(date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0)
  return part('hour') * 60 + part('minute')
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : '人民币汇率中间价刷新失败'
}

export class ExchangeRateRuntime {
  private checkTimer: NodeJS.Timeout | null = null
  private refreshRequest: Promise<ExchangeRateSettings> | null = null

  constructor(private readonly dependencies: ExchangeRateRuntimeDependencies) {}

  start(): void {
    this.checkTimer = setInterval(
      () => void this.refreshAutomatically().catch(() => undefined),
      60 * 60 * 1000
    )
    this.checkTimer.unref()
    void this.refreshAutomatically().catch(() => undefined)
  }

  dispose(): void {
    if (this.checkTimer) clearInterval(this.checkTimer)
    this.checkTimer = null
  }

  refresh(): Promise<ExchangeRateSettings> {
    if (this.refreshRequest) return this.refreshRequest
    const attemptedAt = new Date().toISOString()
    const checkedDate = beijingMinutes() >= 9 * 60 + 20 ? beijingDateKey() : null
    this.refreshRequest = this.dependencies.marketRequestLogger.track(
      {
        dataType: 'exchange-rate',
        caller: 'exchange-rate:safe-cfets',
        source: 'safe-cfets',
        requestedCount: 2
      },
      fetchSafeExchangeRates,
      () => 2
    ).then((snapshot) => {
      const latest = this.dependencies.getState().settings.exchangeRates
      return this.save({
        ...latest,
        rates: { CNY: 1, HKD: snapshot.rates.HKD, USD: snapshot.rates.USD },
        rateDate: snapshot.rateDate,
        fetchedAt: new Date().toISOString(),
        lastCheckedDate: checkedDate,
        lastAttemptedAt: attemptedAt,
        lastError: null
      })
    }).catch((reason) => {
      const latest = this.dependencies.getState().settings.exchangeRates
      this.save({
        ...latest,
        lastCheckedDate: checkedDate,
        lastAttemptedAt: attemptedAt,
        lastError: errorMessage(reason)
      })
      throw reason
    }).finally(() => {
      this.refreshRequest = null
    })
    return this.refreshRequest
  }

  refreshAutomatically(): Promise<ExchangeRateSettings> {
    const settings = this.dependencies.getState().settings.exchangeRates
    const today = beijingDateKey()
    const hasRates = settings.rates.HKD !== null && settings.rates.USD !== null
    if (settings.lastCheckedDate === today && !settings.lastError) {
      return Promise.resolve(settings)
    }
    if (hasRates && beijingMinutes() < 9 * 60 + 20) {
      return Promise.resolve(settings)
    }
    return this.refresh()
  }

  private save(settings: ExchangeRateSettings): ExchangeRateSettings {
    const state = this.dependencies.getState()
    const normalized = normalizeExchangeRateSettings(settings)
    this.dependencies.saveState({
      ...state,
      settings: {
        ...state.settings,
        exchangeRates: normalized
      }
    })
    return normalized
  }
}
