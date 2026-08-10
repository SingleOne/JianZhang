import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  eastmoneyShareholderCode,
  normalizeEastmoneyShareholderPayload,
  type EastmoneyShareholderPayload
} from './shareholder-data'
import { ShareholderService } from './shareholder-service'

const temporaryDirectories: string[] = []

function payload(): EastmoneyShareholderPayload {
  return {
    gdrs: [
      {
        END_DATE: '2025-12-31 00:00:00',
        HOLDER_TOTAL_NUM: 120_000,
        TOTAL_NUM_RATIO: -2.5,
        AVG_FREE_SHARES: 8_300,
        AVG_FREESHARES_RATIO: 2.56,
        HOLD_FOCUS: '较分散',
        AVG_HOLD_AMT: 650_000,
        HOLD_RATIO_TOTAL: 63.2,
        FREEHOLD_RATIO_TOTAL: 62.8
      },
      {
        END_DATE: '2026-03-31 00:00:00',
        HOLDER_TOTAL_NUM: 115_000,
        TOTAL_NUM_RATIO: -4.1667,
        AVG_FREE_SHARES: 8_700,
        AVG_FREESHARES_RATIO: 4.82,
        HOLD_FOCUS: '较分散',
        AVG_HOLD_AMT: 720_000,
        HOLD_RATIO_TOTAL: 64.1,
        FREEHOLD_RATIO_TOTAL: 63.7
      }
    ],
    sjkzr: [{ HOLDER_NAME: '示例国资委', HOLD_RATIO: null }],
    sdgd: [
      {
        END_DATE: '2026-03-31 00:00:00',
        HOLDER_RANK: 1,
        HOLDER_NAME: '示例控股集团',
        SHARES_TYPE: '流通A股',
        HOLD_NUM: 580_000_000,
        HOLD_NUM_RATIO: 48.5,
        HOLD_NUM_CHANGE: '不变',
        CHANGE_RATIO: null
      }
    ],
    sdltgd: [
      {
        END_DATE: '2026-03-31 00:00:00',
        HOLDER_RANK: 1,
        HOLDER_NAME: '示例控股集团',
        HOLDER_TYPE: '其它',
        SHARES_TYPE: 'A股',
        HOLD_NUM: 580_000_000,
        FREE_HOLDNUM_RATIO: 48.5,
        HOLD_NUM_CHANGE: 1_200_000,
        CHANGE_RATIO: 0.21
      }
    ]
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('eastmoneyShareholderCode', () => {
  it('maps Shanghai, Shenzhen and Beijing quote ids', () => {
    expect(eastmoneyShareholderCode('1.600519').eastmoneyCode).toBe('SH600519')
    expect(eastmoneyShareholderCode('0.000001').eastmoneyCode).toBe('SZ000001')
    expect(eastmoneyShareholderCode('0.920799').eastmoneyCode).toBe('BJ920799')
  })
})

describe('normalizeEastmoneyShareholderPayload', () => {
  it('normalizes shareholder summary, history and holding changes', () => {
    const snapshot = normalizeEastmoneyShareholderPayload(
      '1.600519',
      payload(),
      '2026-08-10T08:00:00.000Z'
    )
    expect(snapshot.reportDate).toBe('2026-03-31')
    expect(snapshot.controller?.name).toBe('示例国资委')
    expect(snapshot.latestSummary?.holderCount).toBe(115_000)
    expect(snapshot.holderHistory.map((point) => point.reportDate)).toEqual([
      '2025-12-31',
      '2026-03-31'
    ])
    expect(snapshot.topShareholders[0].changeLabel).toBe('不变')
    expect(snapshot.topFreeShareholders[0].changeShares).toBe(1_200_000)
  })
})

describe('ShareholderService persistence', () => {
  it('writes normalized data to disk and reuses it after a service restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jianzhang-shareholders-'))
    temporaryDirectories.push(directory)
    const now = new Date('2026-08-10T08:00:00.000Z').getTime()
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(payload()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
    )
    const service = new ShareholderService(directory, () => now, fetcher)
    const live = await service.get('1.600519')
    expect(live.fromCache).toBe(false)
    const stored = JSON.parse(
      readFileSync(join(directory, 'shareholders', '1_600519.json'), 'utf8')
    ) as { snapshot: { reportDate: string } }
    expect(stored.snapshot.reportDate).toBe('2026-03-31')

    const offlineFetcher = vi.fn(async () => {
      throw new Error('offline')
    })
    const restarted = new ShareholderService(directory, () => now, offlineFetcher)
    const cached = await restarted.get('1.600519')
    expect(cached.fromCache).toBe(true)
    expect(cached.latestSummary?.holderCount).toBe(115_000)
    expect(offlineFetcher).not.toHaveBeenCalled()
  })
})
