import { describe, expect, it, vi } from 'vitest'
import { net } from 'electron'

vi.mock('electron', () => ({
  net: { fetch: vi.fn() }
}))

vi.mock('pdf-parse', () => ({
  default: vi.fn(async () => ({ text: '公告正文' }))
}))

import {
  CninfoCorporateActionClient,
  CninfoCorporateActionProvider,
  isCnCorporateActionImplementationTitle,
  type CninfoCorporateActionClientLike
} from './cninfo-corporate-action-provider'

describe('CninfoCorporateActionProvider', () => {
  it('keeps implementation announcements and rejects proposal-stage announcements', () => {
    expect(isCnCorporateActionImplementationTitle('2025年年度权益分派实施公告')).toBe(true)
    expect(isCnCorporateActionImplementationTitle('现金红利发放公告')).toBe(true)
    expect(isCnCorporateActionImplementationTitle('现金红利派发公告')).toBe(true)
    expect(isCnCorporateActionImplementationTitle('分红派息公告')).toBe(true)
    expect(isCnCorporateActionImplementationTitle('实施2026年度利润分配公告')).toBe(true)
    expect(isCnCorporateActionImplementationTitle('关于调整2025年年度权益分派方案暨实施公告')).toBe(
      true
    )
    expect(
      isCnCorporateActionImplementationTitle(
        '关于权益分派实施后调整向特定对象发行A股股票发行价格和发行数量的公告'
      )
    ).toBe(false)
    expect(
      isCnCorporateActionImplementationTitle(
        '关于2025年年度权益分派实施后调整回购股份价格上限的公告'
      )
    ).toBe(false)
    expect(isCnCorporateActionImplementationTitle('2025年年度利润分配预案')).toBe(false)
    expect(isCnCorporateActionImplementationTitle('2026年度权益分派实施草案')).toBe(false)
    expect(isCnCorporateActionImplementationTitle('关于利润分配实施方案的议案')).toBe(false)
    expect(isCnCorporateActionImplementationTitle('关于派息政策调整的公告')).toBe(false)
    expect(isCnCorporateActionImplementationTitle('关于派息税率的说明公告')).toBe(false)
    expect(isCnCorporateActionImplementationTitle('2026年度配股发行公告')).toBe(true)
    expect(isCnCorporateActionImplementationTitle('配股提示性公告')).toBe(false)
  })

  it('downloads static PDF documents without the API Origin header', async () => {
    const url = 'https://static.cninfo.com.cn/finalpage/2026-09-08/1225551687.PDF'
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }))

    await new CninfoCorporateActionClient().getDocumentText(url)

    expect(net.fetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        headers: expect.not.objectContaining({ Origin: expect.anything() })
      })
    )
  })

  it('creates separate cash and share candidates from one implementation announcement', async () => {
    const client: CninfoCorporateActionClientLike = {
      listAnnouncements: vi.fn(async () => [
        {
          id: '1200001',
          title: '2025年年度权益分派实施公告',
          publishedAt: '2026-06-15T08:00:00.000Z',
          url: 'https://static.cninfo.com.cn/finalpage/2026-06-15/1200001.PDF'
        },
        {
          id: '1200000',
          title: '2025年年度利润分配预案',
          publishedAt: '2026-04-01T08:00:00.000Z',
          url: 'https://static.cninfo.com.cn/finalpage/2026-04-01/1200000.PDF'
        }
      ]),
      getDocumentText: vi.fn(async () =>
        [
          '每10股派发现金红利1.50元（含税），每10股送红股1股，以资本公积金每10股转增2股。',
          '股权登记日：2026年6月18日，除权除息日：2026年6月19日，',
          '现金红利发放日：2026年6月19日，新增股份上市日：2026年6月20日。'
        ].join('')
      )
    }

    const result = await new CninfoCorporateActionProvider(client).fetch('1.600000')

    expect(result.candidates).toHaveLength(2)
    expect(result.candidates.map((candidate) => candidate.type)).toEqual([
      'cashDividend',
      'stockDividend'
    ])
    expect(result.candidates[0]).toMatchObject({
      id: 'cninfo:1.600000:2025-年度:cash',
      recordDate: '2026-06-18',
      payableDate: '2026-06-19'
    })
    expect(result.candidates[1]).toMatchObject({
      id: 'cninfo:1.600000:2025-年度:shares',
      effectiveDate: '2026-06-20'
    })
    expect(client.getDocumentText).toHaveBeenCalledTimes(1)
  })

  it('uses the Changan implementation announcement instead of a later price adjustment', async () => {
    const url = 'https://static.cninfo.com.cn/finalpage/2026-07-10/1225416905.PDF'
    const client: CninfoCorporateActionClientLike = {
      listAnnouncements: vi.fn(async () => [
        {
          id: '1225436733',
          title: '关于权益分派实施后调整向特定对象发行A股股票发行价格和发行数量的公告',
          publishedAt: '2026-07-22T16:00:00.000Z',
          url: 'https://static.cninfo.com.cn/finalpage/2026-07-23/1225436733.PDF'
        },
        {
          id: '1225416905',
          title: '2025年年度权益分派实施公告',
          publishedAt: '2026-07-09T16:00:00.000Z',
          url
        }
      ]),
      getDocumentText: vi.fn(
        async () =>
          '以公司现有总股本9,912,905,548股剔除已回购股份154,672,920股后的9,758,232,628股为基数，向全体股东每10股派1.168230元（含税），不进行资本公积金转增股本，不送红股。股权登记日为2026年7月15日，除权除息日为2026年7月16日。'
      )
    }

    const result = await new CninfoCorporateActionProvider(client).fetch('0.000625')

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      type: 'cashDividend',
      announcementDate: '2026-07-10',
      recordDate: '2026-07-15',
      exDate: '2026-07-16',
      providerEventId: '1225416905',
      terms: { amountPerShare: { value: expect.closeTo(0.116823, 12) } },
      evidence: [{ url, publishedAt: '2026-07-09T16:00:00.000Z' }]
    })
    expect(client.getDocumentText).toHaveBeenCalledExactlyOnceWith(url)
  })

  it.each([
    { title: '现金红利发放公告', text: '每10股派现金红利1元。', suffix: 'cash' },
    { title: '配股发行公告', text: '每10股配售3股，配股价格5元/股。', suffix: 'rights' }
  ])(
    'uses the Beijing date for $suffix candidates without a record date',
    async ({ title, text, suffix }) => {
      const client: CninfoCorporateActionClientLike = {
        listAnnouncements: vi.fn(async () => [
          {
            id: '1200002',
            title,
            publishedAt: '2026-07-22T16:00:00.000Z',
            url: 'https://static.cninfo.com.cn/finalpage/2026-07-23/1200002.PDF'
          }
        ]),
        getDocumentText: vi.fn(async () => text)
      }

      const result = await new CninfoCorporateActionProvider(client).fetch('0.000625')

      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0]).toMatchObject({
        id: `cninfo:0.000625:2026-07-23:${suffix}`,
        announcementDate: '2026-07-23'
      })
    }
  )
})
