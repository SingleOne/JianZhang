export const EASTMONEY_SEARCH_TOKEN = 'D43BF722C8E33A67B1BDCC6FDED9C901'
export const EASTMONEY_RADAR_TOKEN = '7eea3edcaed734bea9cbfc24409ed989'

export const EASTMONEY_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://quote.eastmoney.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

export const TENCENT_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://gu.qq.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

export const SINA_HEADERS: Record<string, string> = {
  Accept: '*/*',
  Referer: 'https://finance.sina.com.cn/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

export const MARKET_INDEX_QUOTE_IDS = new Set([
  '1.000001',
  '0.399001',
  '0.399006',
  '1.000016',
  '1.000300',
  '1.000688',
  '1.000905',
  '1.000852',
  '0.899050'
])

export const EASTMONEY_FIXED_PARAMS = {
  search: {
    type: '14',
    count: '10'
  },
  orderBook: {
    invt: '2',
    fltt: '2'
  },
  intraday: {
    ndays: '1',
    iscr: '1',
    iscca: '0'
  },
  historicalKline: {
    fqt: '1',
    end: '20500101'
  },
  fundsFlow: {
    lmt: '0',
    klt: '1'
  },
  radar: {
    pageIndex: '0',
    pageSize: '3000',
    dpt: 'wzchanges'
  }
} as const

export const EASTMONEY_FIELDS = {
  quotes: 'f2,f3,f4,f5,f6,f8,f12,f13,f14,f15,f16,f17,f18',
  orderBook:
    'f43,f58,f60,f531,f11,f12,f13,f14,f15,f16,f17,f18,f19,f20,f31,f32,f33,f34,f35,f36,f37,f38,f39,f40',
  intradayPrimary: 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13',
  intradaySecondary: 'f51,f52,f53,f54,f55,f56,f57,f58',
  historicalKlinePrimary: 'f1,f2,f3,f4,f5,f6',
  historicalKlineSecondary: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
  fundsFlowPrimary: 'f1,f2,f3,f7',
  fundsFlowSecondary: 'f51,f52,f53,f54,f55'
} as const

export const RADAR_TYPES = [
  8201, 8202, 8193, 4, 32, 64, 8207, 8209, 8211, 8213, 8215, 8204, 8203, 8194, 8, 16, 128, 8208,
  8210, 8212, 8214, 8216
]

export const RADAR_LABELS: Record<number, { label: string; direction: 'up' | 'down' }> = {
  4: { label: '封涨停板', direction: 'up' },
  8: { label: '封跌停板', direction: 'down' },
  16: { label: '打开涨停板', direction: 'down' },
  32: { label: '打开跌停板', direction: 'up' },
  64: { label: '有大买盘', direction: 'up' },
  128: { label: '有大卖盘', direction: 'down' },
  8193: { label: '大笔买入', direction: 'up' },
  8194: { label: '大笔卖出', direction: 'down' },
  8201: { label: '火箭发射', direction: 'up' },
  8202: { label: '快速反弹', direction: 'up' },
  8203: { label: '高台跳水', direction: 'down' },
  8204: { label: '加速下跌', direction: 'down' },
  8207: { label: '竞价上涨', direction: 'up' },
  8208: { label: '竞价下跌', direction: 'down' },
  8209: { label: '高开5日线', direction: 'up' },
  8210: { label: '低开5日线', direction: 'down' },
  8211: { label: '向上缺口', direction: 'up' },
  8212: { label: '向下缺口', direction: 'down' },
  8213: { label: '60日新高', direction: 'up' },
  8214: { label: '60日新低', direction: 'down' },
  8215: { label: '60日大幅上涨', direction: 'up' },
  8216: { label: '60日大幅下跌', direction: 'down' }
}
