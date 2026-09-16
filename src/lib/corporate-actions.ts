import type {
  CorporateActionCandidate,
  CorporateActionTerms,
  CorporateActionType,
  StockCurrency
} from '../shared/types'

export interface CnCorporateActionEffect {
  type: Extract<CorporateActionType, 'cashDividend' | 'stockDividend'>
  terms: Extract<CorporateActionTerms, { kind: 'cashDividend' | 'shareRatio' }>
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twenty: 20
}

function numeric(value: string): number | undefined {
  const normalized = value.trim().toLowerCase()
  const number = Number(normalized.replaceAll(',', ''))
  return Number.isFinite(number) ? number : NUMBER_WORDS[normalized]
}

export function classifyCorporateAction(text: string): CorporateActionType | null {
  if (/配股.*(?:发行|实施|结果|上市)|每\s*[\d,.]+\s*股(?:可)?配\s*[\d,.]+\s*股/.test(text)) {
    return 'rightsIssue'
  }
  if (/送红股|送股|转增股本|资本公积金转增/.test(text)) return 'stockDividend'
  if (/权益分派|利润分配|分红派息|现金红利|现金股利|每\s*[\d,.]+\s*股派/.test(text)) {
    return 'cashDividend'
  }
  if (/return of capital|capital distribution/i.test(text)) return 'returnOfCapital'
  if (/reverse stock split|share consolidation|consolidation of shares/i.test(text)) {
    return 'reverseSplit'
  }
  if (/stock split|share subdivision|subdivision of shares/i.test(text)) return 'split'
  if (/rights issue|rights offering|open offer/i.test(text)) return 'rightsIssue'
  if (
    /bonus issue|bonus shares|stock dividend|scrip dividend|capitali[sz]ation issue/i.test(text)
  ) {
    return 'stockDividend'
  }
  if (
    /cash dividend|special dividend|interim dividend|final dividend|distribution per share/i.test(
      text
    )
  ) {
    return 'cashDividend'
  }
  if (/change of.*(?:stock code|ticker|company name)|symbol change|name change/i.test(text)) {
    return 'symbolChange'
  }
  if (/spin.?off|demerger/i.test(text)) return 'spinOff'
  if (/merger|scheme of arrangement|security conversion|conversion of securities/i.test(text)) {
    return 'mergerExchange'
  }
  if (/delisting|withdrawal of listing|privati[sz]ation|cancellation of listing/i.test(text)) {
    return 'delistingCash'
  }
  return null
}

function currencyFromText(value: string): StockCurrency | undefined {
  if (/\b(?:HKD|HK\$|HONG KONG DOLLARS?)\b/i.test(value)) return 'HKD'
  if (/\b(?:USD|US\$|U\.S\. DOLLARS?)\b|\$/i.test(value)) return 'USD'
  if (/\b(?:CNY|RMB|RENMINBI)\b|人民币/i.test(value)) return 'CNY'
  return undefined
}

function amountPerShareFromText(value: string): number | undefined {
  const direct = value.match(
    /(?:HKD|USD|CNY|RMB|HK\$|US\$|\$)\s*([\d,.]+)\s*(?:per|for each)\s+(?:ordinary\s+)?share/i
  )
  if (direct) return numeric(direct[1])
  const cents = value.match(/([\d,.]+)\s*(?:HK|US)?\s*cents?\s+per\s+(?:ordinary\s+)?share/i)
  return cents ? (numeric(cents[1]) ?? 0) / 100 : undefined
}

function ratioFromText(
  value: string,
  type: CorporateActionType
): { oldShares?: number; newShares?: number } {
  const chineseRights = value.match(
    /(?:每|按每)\s*([\d,.]+)\s*股(?:可)?(?:获配|配售|配)\s*([\d,.]+)\s*股/
  )
  if (chineseRights) {
    return { oldShares: numeric(chineseRights[1]), newShares: numeric(chineseRights[2]) }
  }
  const forRatio = value.match(/([\d,.]+)\s*[- ]for[- ]\s*([\d,.]+)/i)
  if (forRatio) return { newShares: numeric(forRatio[1]), oldShares: numeric(forRatio[2]) }
  const explicit = value.match(
    /([\d,.]+|one|two|three|four|five|six|seven|eight|nine|ten|twenty)\s+(?:new\s+)?(?:rights?\s+)?shares?\s+for\s+(?:every\s+)?([\d,.]+|one|two|three|four|five|six|seven|eight|nine|ten|twenty)\s+(?:existing\s+)?shares?/i
  )
  if (explicit) return { newShares: numeric(explicit[1]), oldShares: numeric(explicit[2]) }
  const subdivision = value.match(
    /(?:each|every)\s+(?:one\s+)?existing\s+share\s+into\s+([\d,.]+|two|three|four|five|ten|twenty)\s+(?:new\s+)?shares?/i
  )
  if (subdivision) return { oldShares: 1, newShares: numeric(subdivision[1]) }
  const consolidation = value.match(
    /(?:every|each)\s+([\d,.]+|two|three|four|five|ten|twenty)\s+existing\s+shares?\s+into\s+(?:one|1)\s+(?:new\s+)?share/i
  )
  if (consolidation) return { oldShares: numeric(consolidation[1]), newShares: 1 }
  return type === 'symbolChange' ? { oldShares: 1, newShares: 1 } : {}
}

function subscriptionPriceFromText(value: string): number | undefined {
  const chinese = value.match(
    /配股(?:发行)?价格\s*(?:为|：|:)?\s*(?:人民币)?\s*([\d,.]+)\s*元\s*(?:\/\s*股|每股)?/
  )
  if (chinese) return numeric(chinese[1])
  const matched = value.match(
    /subscription price[^\d]*(?:HKD|USD|CNY|RMB|HK\$|US\$|\$)?\s*([\d,.]+)/i
  )
  return matched ? numeric(matched[1]) : undefined
}

function extracted<T>(value: T | undefined, evidenceText?: string) {
  return {
    value,
    confidence: value === undefined ? ('low' as const) : ('high' as const),
    evidenceText: value === undefined ? undefined : evidenceText
  }
}

export function extractCorporateActionTerms(
  type: CorporateActionType,
  text: string,
  quoteId: string
): CorporateActionTerms {
  if (type === 'cashDividend' || type === 'returnOfCapital') {
    return {
      kind: 'cashDividend',
      amountPerShare: extracted(amountPerShareFromText(text), text),
      currency: extracted(currencyFromText(text), text)
    }
  }
  if (type === 'stockDividend' || type === 'split' || type === 'reverseSplit') {
    const ratio = ratioFromText(text, type)
    return {
      kind: 'shareRatio',
      oldShares: extracted(ratio.oldShares, text),
      newShares: extracted(ratio.newShares, text)
    }
  }
  if (type === 'rightsIssue') {
    const ratio = ratioFromText(text, type)
    const isChineseRightsIssue = /配股|获配|配售/.test(text)
    return {
      kind: 'rightsIssue',
      heldShares: extracted(ratio.oldShares, text),
      entitlementShares: extracted(ratio.newShares, text),
      subscriptionPrice: extracted(subscriptionPriceFromText(text), text),
      currency: extracted(
        currencyFromText(text) ?? (isChineseRightsIssue ? 'CNY' : undefined),
        text
      )
    }
  }
  if (type === 'symbolChange') {
    return {
      kind: 'symbolChange',
      oldQuoteId: extracted(quoteId, text),
      newQuoteId: extracted(undefined),
      newCode: extracted(undefined)
    }
  }
  if (type === 'mergerExchange') {
    const ratio = ratioFromText(text, type)
    return {
      kind: 'securityConversion',
      oldShares: extracted(ratio.oldShares, text),
      newShares: extracted(ratio.newShares, text)
    }
  }
  return { kind: 'unsupported' }
}

function chineseDistributionMatch(
  text: string,
  pattern: RegExp
): { baseShares: number; amount: number; evidenceText: string } | null {
  const matched = text.match(pattern)
  if (!matched) return null
  const baseShares = numeric(matched[1])
  const amount = numeric(matched[2])
  return baseShares && amount !== undefined
    ? { baseShares, amount, evidenceText: matched[0] }
    : null
}

export function extractCnCorporateActionEffects(text: string): CnCorporateActionEffect[] {
  const normalized = text.replace(/，/g, ',').replace(/：/g, ':').replace(/\s+/g, ' ').trim()
  const cash = chineseDistributionMatch(
    normalized,
    /每\s*([\d,.]+)\s*股[^。；;]{0,100}?(?:派发?|分配)\s*(?:人民币)?\s*(?:现金红利|现金股利|现金)?\s*(?:人民币)?\s*([\d,.]+)\s*元/
  )
  const bonus = chineseDistributionMatch(
    normalized,
    /每\s*([\d,.]+)\s*股[^。；;]{0,100}?送(?:红股)?\s*([\d,.]+)\s*股/
  )
  const capitalized = chineseDistributionMatch(
    normalized,
    /每\s*([\d,.]+)\s*股[^。；;]{0,100}?(?:以[^。；;]{0,40}?资本公积金)?转增\s*([\d,.]+)\s*股/
  )
  const effects: CnCorporateActionEffect[] = []
  if (cash && cash.amount > 0) {
    effects.push({
      type: 'cashDividend',
      terms: {
        kind: 'cashDividend',
        amountPerShare: extracted(cash.amount / cash.baseShares, cash.evidenceText),
        currency: extracted('CNY', cash.evidenceText)
      }
    })
  }
  if ((bonus?.amount ?? 0) > 0 || (capitalized?.amount ?? 0) > 0) {
    const commonBase =
      bonus && capitalized && bonus.baseShares !== capitalized.baseShares
        ? 1
        : (bonus?.baseShares ?? capitalized?.baseShares ?? 1)
    const addedPerShare =
      (bonus ? bonus.amount / bonus.baseShares : 0) +
      (capitalized ? capitalized.amount / capitalized.baseShares : 0)
    const newShares = Number((commonBase * (1 + addedPerShare)).toFixed(12))
    const evidenceText = [bonus?.evidenceText, capitalized?.evidenceText].filter(Boolean).join('；')
    effects.push({
      type: 'stockDividend',
      terms: {
        kind: 'shareRatio',
        oldShares: extracted(commonBase, evidenceText),
        newShares: extracted(newShares, evidenceText)
      }
    })
  }
  return effects
}

function namedDate(text: string, labels: RegExp): string | undefined {
  const dayFirst = text.match(
    new RegExp(
      `(?:${labels.source})[^\\d]{0,40}(\\d{1,2})[\\s/-]+(January|February|March|April|May|June|July|August|September|October|November|December|\\d{1,2})[\\s/-]+(20\\d{2})`,
      'i'
    )
  )
  const monthNames = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december'
  ]
  if (dayFirst) {
    const month = /^\d+$/.test(dayFirst[2])
      ? Number(dayFirst[2])
      : monthNames.indexOf(dayFirst[2].toLowerCase()) + 1
    return `${dayFirst[3]}-${String(month).padStart(2, '0')}-${String(Number(dayFirst[1])).padStart(2, '0')}`
  }
  const monthFirst = text.match(
    new RegExp(
      `(?:${labels.source}).{0,40}?(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(20\\d{2})`,
      'i'
    )
  )
  if (monthFirst) {
    const month = monthNames.indexOf(monthFirst[1].toLowerCase()) + 1
    return `${monthFirst[3]}-${String(month).padStart(2, '0')}-${String(Number(monthFirst[2])).padStart(2, '0')}`
  }
  const iso = text.match(
    new RegExp(`(?:${labels.source})[^\\d]{0,40}(20\\d{2})-(\\d{2})-(\\d{2})`, 'i')
  )
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : undefined
}

function chineseNamedDate(text: string, labels: RegExp): string | undefined {
  const chinese = text.match(
    new RegExp(
      `(?:${labels.source})[^\\d]{0,30}(20\\d{2})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日`,
      'i'
    )
  )
  if (chinese) {
    return `${chinese[1]}-${String(Number(chinese[2])).padStart(2, '0')}-${String(Number(chinese[3])).padStart(2, '0')}`
  }
  const separated = text.match(
    new RegExp(`(?:${labels.source})[^\\d]{0,30}(20\\d{2})[./-](\\d{1,2})[./-](\\d{1,2})`, 'i')
  )
  return separated
    ? `${separated[1]}-${String(Number(separated[2])).padStart(2, '0')}-${String(Number(separated[3])).padStart(2, '0')}`
    : undefined
}

export function extractCorporateActionDates(
  text: string
): Pick<
  CorporateActionCandidate,
  'exDate' | 'recordDate' | 'payableDate' | 'effectiveDate' | 'electionDeadline'
> {
  return {
    exDate:
      namedDate(text, /ex[- ](?:dividend|entitlement) date/) ??
      chineseNamedDate(text, /除权除息日|除权日|除息日/),
    recordDate:
      namedDate(
        text,
        /record date|(?:shareholders?|stockholders?|holders?) of record(?:\s+as of(?:\s+the close of business)?(?:\s+on)?)?/
      ) ?? chineseNamedDate(text, /股权登记日/),
    payableDate:
      namedDate(text, /pay(?:able|ment) date|dividend is payable(?:\s+on)?/) ??
      chineseNamedDate(text, /现金红利发放日|现金股利发放日|红利发放日|派息日/),
    effectiveDate:
      namedDate(text, /effective date/) ??
      chineseNamedDate(
        text,
        /新增(?:无限售条件流通)?股份上市日|送转股上市日|股份上市日|新增股份到账日/
      ),
    electionDeadline:
      namedDate(text, /(?:election|acceptance) deadline|latest time for acceptance/) ??
      chineseNamedDate(text, /配股缴款截止日|认购缴款截止日|缴款截止日/)
  }
}

export const CORPORATE_ACTION_TYPE_LABELS: Record<CorporateActionType, string> = {
  cashDividend: '现金分红',
  stockDividend: '股票股息',
  split: '拆股',
  reverseSplit: '合股',
  rightsIssue: '供股/公开发售',
  spinOff: '分拆上市',
  mergerExchange: '并购换股/证券转换',
  symbolChange: '代码/名称变更',
  delistingCash: '退市现金结算',
  returnOfCapital: '资本返还',
  manualCash: '手工现金调整'
}

export const CORPORATE_ACTION_STATUS_LABELS: Record<CorporateActionCandidate['status'], string> = {
  detected: '待确认',
  needsReview: '需补充',
  confirmed: '已确认',
  applied: '已入账',
  ignored: '已忽略',
  revised: '已修订',
  reversed: '已撤销'
}
