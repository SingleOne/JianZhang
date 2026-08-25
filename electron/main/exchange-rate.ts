const SAFE_EXCHANGE_RATE_URL = 'https://www.safe.gov.cn/AppStructured/hlw/RMBQuery.do'

export interface SafeExchangeRateSnapshot {
  rateDate: string
  rates: {
    HKD: number
    USD: number
  }
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, '')
}

export function parseSafeExchangeRateHtml(html: string): SafeExchangeRateSnapshot {
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
  for (const row of rows) {
    const cells = [...row[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((cell) => plainText(cell[1]))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0] ?? '')) continue
    const usdPerHundred = Number(cells[1])
    const hkdPerHundred = Number(cells[4])
    if (!(usdPerHundred > 0) || !(hkdPerHundred > 0)) continue
    return {
      rateDate: cells[0],
      rates: {
        HKD: hkdPerHundred / 100,
        USD: usdPerHundred / 100
      }
    }
  }
  throw new Error('未能从外汇局页面识别美元、港币人民币汇率中间价')
}

export async function fetchSafeExchangeRates(): Promise<SafeExchangeRateSnapshot> {
  const response = await fetch(SAFE_EXCHANGE_RATE_URL, {
    headers: {
      'User-Agent': 'Jianzhang Stock Desktop',
      Referer: 'https://www.safe.gov.cn/safe/rmbhlzjj/'
    },
    signal: AbortSignal.timeout(20_000)
  })
  if (!response.ok) throw new Error(`国家外汇管理局返回 HTTP ${response.status}`)
  return parseSafeExchangeRateHtml(await response.text())
}
