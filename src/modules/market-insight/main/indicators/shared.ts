import type { IndicatorState, IndicatorUnit, IndicatorValue } from '../../shared/types'

export function directionState(value: number | null): IndicatorState {
  if (value === null || !Number.isFinite(value)) return 'unknown'
  if (value === 0) return 'flat'
  return value > 0 ? 'up' : 'down'
}

export function indicator(
  id: string,
  label: string,
  value: number | null,
  unit: IndicatorUnit,
  calculatedAt: string,
  sourcePeriod: string,
  state: IndicatorState = 'unknown'
): IndicatorValue {
  return { id, label, value, unit, state, calculatedAt, sourcePeriod }
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

export function average(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((total, value) => total + value, 0) / values.length
}

export function standardDeviation(values: readonly number[]): number | null {
  const mean = average(values)
  if (mean === null || values.length < 2) return null
  return Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length)
}
