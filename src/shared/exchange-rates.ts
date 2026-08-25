import type { ExchangeRateSettings } from './types'
import type { StockCurrency } from './stock-market'

export function exchangeRateForCurrency(
  settings: ExchangeRateSettings,
  currency: StockCurrency
): number | null {
  if (currency === 'CNY') return 1
  return settings.manualOverrides[currency] ?? settings.rates[currency]
}

export function convertToCny(
  amount: number | null,
  currency: StockCurrency,
  settings: ExchangeRateSettings
): number | null {
  if (amount === null) return null
  const rate = exchangeRateForCurrency(settings, currency)
  return rate === null ? null : amount * rate
}

export function usesManualExchangeRate(
  settings: ExchangeRateSettings,
  currency: 'HKD' | 'USD'
): boolean {
  return settings.manualOverrides[currency] !== undefined
}
