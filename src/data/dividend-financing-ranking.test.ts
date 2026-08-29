import { describe, expect, it } from 'vitest'
import snapshot from './dividend-financing-ranking.json'

describe('dividend financing ranking snapshot', () => {
  it('contains a complete, descending schema v2 snapshot', () => {
    expect(snapshot.schemaVersion).toBe(2)
    expect(snapshot.scoreMethodologyVersion).toBe(1)
    expect(snapshot.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(snapshot.rows.length).toBeGreaterThan(1000)
    expect(new Set(snapshot.rows.map((item) => item.code)).size).toBe(snapshot.rows.length)
    expect(new Set(snapshot.rows.map((item) => item.scoreRank)).size).toBe(snapshot.rows.length)

    snapshot.rows.forEach((item, index) => {
      expect(item.rank).toBe(index + 1)
      expect(item.ratio).toBeGreaterThan(snapshot.thresholdPercent)
      expect(['SH', 'SZ', 'BJ']).toContain(item.market)
      expect(item.netReturnYi).toBeCloseTo(item.dividendYi - item.financingYi, 3)
      expect(item.annualDividends.map((point) => point.year)).toEqual(
        [...item.annualDividends].map((point) => point.year).sort((left, right) => left - right)
      )
      expect(item.financingEvents.map((event) => event.date)).toEqual(
        [...item.financingEvents].map((event) => event.date).sort()
      )
      expect(item.financingCount).toBe(item.financingEvents.length)
      expect(item.qualityScore).toBeGreaterThanOrEqual(0)
      expect(item.qualityScore).toBeLessThanOrEqual(100)
      expect(
        Object.values(item.qualityScoreBreakdown).reduce((total, value) => total + value, 0)
      ).toBeCloseTo(item.qualityScore, 1)
      if (index > 0) expect(item.ratio).toBeLessThanOrEqual(snapshot.rows[index - 1].ratio)
    })
  })
})
