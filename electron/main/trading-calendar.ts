const SSE_TRADING_CALENDAR_URL = 'https://www.sse.com.cn/disclosure/dealinstruc/closed/'
const DAY_IN_MILLISECONDS = 86_400_000

export interface SseTradingCalendar {
  year: number
  closedDates: string[]
}

export interface HkexTradingCalendar {
  year: number
  closedDates: string[]
  halfDayDates: string[]
}

interface HkexCalendarEvent {
  name?: string
  description?: string
  startdate?: string
  holidayIcon?: string
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, '')
}

function utcTime(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day)
}

function dateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function closedDatesFromRow(rowHtml: string, calendarYear: number): string[] {
  const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
  const description = plainText(cells.at(-1)?.[1] ?? '')
  const closure = description.split('休市')[0]
  const range = closure.match(
    /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日(?:（[^）]*）)?(?:至(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日(?:（[^）]*）)?)?/
  )
  if (!range) return []

  const startYear = Number(range[1] ?? calendarYear)
  const startMonth = Number(range[2])
  const startDay = Number(range[3])
  const endYear = Number(range[4] ?? startYear)
  const endMonth = Number(range[5] ?? startMonth)
  const endDay = Number(range[6] ?? startDay)
  const dates: string[] = []
  for (
    let time = utcTime(startYear, startMonth, startDay);
    time <= utcTime(endYear, endMonth, endDay);
    time += DAY_IN_MILLISECONDS
  ) {
    const value = dateKey(time)
    if (value.startsWith(`${calendarYear}-`)) dates.push(value)
  }
  return dates
}

export async function fetchSseTradingCalendar(expectedYear: number): Promise<SseTradingCalendar> {
  const response = await fetch(SSE_TRADING_CALENDAR_URL, {
    headers: {
      'User-Agent': 'Jianzhang Stock Desktop',
      Referer: 'https://www.sse.com.cn/'
    },
    signal: AbortSignal.timeout(20_000)
  })
  if (!response.ok) throw new Error(`上交所返回 HTTP ${response.status}`)

  const html = await response.text()
  const heading = html.match(/<strong>\s*(\d{4})年休市安排\s*<\/strong>/i)
  const publishedYear = Number(heading?.[1])
  if (publishedYear !== expectedYear || heading?.index === undefined) {
    throw new Error(`上交所尚未发布 ${expectedYear} 年休市安排`)
  }

  const section = html.slice(heading.index)
  const table = section.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i)?.[1] ?? ''
  const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
  const closedDates = [...new Set(rows.flatMap((row) => closedDatesFromRow(row[0], expectedYear)))].sort()
  if (closedDates.length === 0) throw new Error('未能从上交所页面识别休市日期')

  return { year: expectedYear, closedDates }
}

export async function fetchHkexTradingCalendar(expectedYear: number): Promise<HkexTradingCalendar> {
  const url = new URL('https://www.hkex.com.hk/News/HKEX-Calendar')
  url.searchParams.set('sc_lang', 'en')
  url.searchParams.set('currenttab', 'search-result')
  url.searchParams.set('datefrom', `${expectedYear}-01-01`)
  url.searchParams.set('dateto', `${expectedYear}-12-31`)
  url.searchParams.set('defaultdate', `${expectedYear}-01-01`)
  url.searchParams.set('order', 'asc')
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Jianzhang Stock Desktop',
      Referer: 'https://www.hkex.com.hk/'
    },
    signal: AbortSignal.timeout(20_000)
  })
  if (!response.ok) throw new Error(`港交所返回 HTTP ${response.status}`)

  const html = await response.text()
  const encoded = html.match(/calendarDataSource\s*=\s*'([\s\S]*?)';/)?.[1]
  if (!encoded) throw new Error('未能从港交所页面识别日历数据')
  const events = (JSON.parse(encoded) as { monthly?: HkexCalendarEvent[] }).monthly ?? []
  const annualEvents = events.filter((event) => event.startdate?.startsWith(`${expectedYear}-`))
  const closedDates = [...new Set(
    annualEvents
      .filter((event) => event.holidayIcon === 'HongKongPublicHolidays')
      .flatMap((event) => event.startdate ? [event.startdate] : [])
  )].sort()
  const halfDayDates = [...new Set(
    annualEvents
      .filter((event) =>
        `${event.name ?? ''} ${event.description ?? ''}`.includes('Half-Day Trading Day')
      )
      .flatMap((event) => event.startdate ? [event.startdate] : [])
  )].sort()
  if (closedDates.length === 0 || halfDayDates.length === 0) {
    throw new Error(`港交所 ${expectedYear} 年日历数据不完整`)
  }
  return { year: expectedYear, closedDates, halfDayDates }
}
