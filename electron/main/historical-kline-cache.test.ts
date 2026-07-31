import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { KlineResult } from '../../src/shared/types'
import { HistoricalKlineCache } from './historical-kline-cache'

const DAY = 24 * 60 * 60 * 1000

function result(quoteId: string, name = quoteId): KlineResult {
  return {
    quoteId,
    name,
    tradingDate: '2026-07-31',
    bars: [
      {
        time: '2026-07-31',
        open: 10,
        close: 10,
        high: 10,
        low: 10,
        volume: 100,
        amount: 1_000,
        turnoverRate: 1
      }
    ]
  }
}

describe('HistoricalKlineCache', () => {
  let directory: string
  const now = new Date('2026-07-31T08:00:00.000Z').getTime()

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jianzhang-historical-kline-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('removes disk cache files that have not been accessed for 90 days', () => {
    const cacheDirectory = join(directory, 'klines')
    mkdirSync(cacheDirectory)
    const expiredPath = join(cacheDirectory, 'expired-daily.json')
    const activePath = join(cacheDirectory, 'active-daily.json')
    writeFileSync(expiredPath, '{}', 'utf8')
    writeFileSync(activePath, '{}', 'utf8')
    utimesSync(expiredPath, new Date(now - 91 * DAY), new Date(now - 91 * DAY))
    utimesSync(activePath, new Date(now - 89 * DAY), new Date(now - 89 * DAY))

    new HistoricalKlineCache(directory, 150, 90 * DAY, () => now)

    expect(existsSync(expiredPath)).toBe(false)
    expect(existsSync(activePath)).toBe(true)
  })

  it('updates the disk access time when a cached entry is used', () => {
    const cache = new HistoricalKlineCache(directory, 150, 90 * DAY, () => now)
    cache.save('1.600000', 'daily', 120, result('1.600000'))
    const path = join(directory, 'klines', '1_600000-daily.json')
    utimesSync(path, new Date(now - 30 * DAY), new Date(now - 30 * DAY))

    expect(cache.getFallback('1.600000', 'daily')).not.toBeNull()
    expect(statSync(path).mtimeMs).toBe(now)
  })

  it('reloads an entry from disk after the memory LRU evicts it', () => {
    const cache = new HistoricalKlineCache(directory, 1, 90 * DAY, () => now)
    cache.save('1.600000', 'daily', 120, result('1.600000', '内存数据'))
    cache.save('0.000001', 'daily', 120, result('0.000001'))

    const path = join(directory, 'klines', '1_600000-daily.json')
    const entry = JSON.parse(readFileSync(path, 'utf8')) as { data: KlineResult }
    entry.data.name = '磁盘数据'
    writeFileSync(path, JSON.stringify(entry), 'utf8')

    expect(cache.getFallback('1.600000', 'daily')?.name).toBe('磁盘数据')
  })
})
