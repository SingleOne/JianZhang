import { describe, expect, it } from 'vitest'
import type { KlineBar } from './types'
import { calculateMovingAverages } from './moving-average'

function bars(count: number): KlineBar[] {
  return Array.from({ length: count }, (_, index) => ({
    time: `2026-01-${String(index + 1).padStart(2, '0')}`,
    open: index + 1,
    close: index + 1,
    high: index + 1,
    low: index + 1,
    volume: 1,
    amount: 1
  }))
}

describe('calculateMovingAverages', () => {
  it('aligns MA5, MA10, MA20 and MA60 with the closing bar that completes each window', () => {
    const points = calculateMovingAverages(bars(65))

    expect(points[3].values).toEqual({})
    expect(points[4].values).toEqual({ 5: 3 })
    expect(points[9].values).toMatchObject({ 5: 8, 10: 5.5 })
    expect(points[59].values).toEqual({ 5: 58, 10: 55.5, 20: 50.5, 60: 30.5 })
    expect(points[64].values).toEqual({ 5: 63, 10: 60.5, 20: 55.5, 60: 35.5 })
  })
})
