const OFFICIAL_STOCK_SOURCE_HOSTS = new Set([
  'static.cninfo.com.cn',
  'www.cninfo.com.cn',
  'www.csrc.gov.cn',
  'www.sse.com.cn',
  'www.szse.cn',
  'www.bse.cn',
  'www1.hkexnews.hk',
  'www.hkexnews.hk',
  'www.sec.gov',
  'sec.gov'
])

export function isOfficialStockSourceUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && OFFICIAL_STOCK_SOURCE_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

export function assertOfficialStockSourceUrl(value: string): void {
  if (!isOfficialStockSourceUrl(value)) {
    throw new Error('只能打开受支持交易所或监管机构的官方来源')
  }
}
