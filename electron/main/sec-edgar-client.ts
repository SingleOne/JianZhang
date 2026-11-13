import { version } from '../../package.json'
import { OfficialSourceHttpError, requestOfficialSourceBytes } from './official-source-request'

const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers_exchange.json'
const SEC_TICKERS_FALLBACK_URL = 'https://www.sec.gov/files/company_tickers.json'
const SEC_DATA_BASE_URL = 'https://data.sec.gov'
const SEC_CONTACT_EMAIL = 'SingleOne@users.noreply.github.com'
// Declare the application directly; keep the contact address in From for both connections.
const SEC_USER_AGENT = process.env.JIANZHANG_SEC_USER_AGENT?.trim() || `JianZhangDesktop/${version}`
const SEC_HEADERS = {
  Accept: 'application/json',
  'Accept-Encoding': 'gzip, deflate',
  From: SEC_CONTACT_EMAIL,
  'User-Agent': SEC_USER_AGENT
}
export const SEC_DOCUMENT_HEADERS = {
  Accept: 'text/plain, text/html, */*',
  'Accept-Encoding': 'gzip, deflate',
  From: SEC_CONTACT_EMAIL,
  'User-Agent': SEC_USER_AGENT
}

class SecHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    const hint = status === 403 ? '（访问被拒绝，请检查网络连接或稍后重试）' : ''
    super(`${message}：HTTP ${status}${hint}`)
  }
}

export interface SecIssuer {
  cik: number
  name: string
  ticker: string
  exchange: string
}

export interface SecSubmissionsRecent {
  accessionNumber?: string[]
  filingDate?: string[]
  reportDate?: string[]
  form?: string[]
  primaryDocument?: string[]
  primaryDocDescription?: string[]
}

export interface SecSubmissions {
  cik?: string
  name?: string
  fiscalYearEnd?: string
  filings?: { recent?: SecSubmissionsRecent }
}

export interface SecCompanyFactUnit {
  start?: string
  end?: string
  val?: number
  accn?: string
  fy?: number
  fp?: string
  form?: string
  filed?: string
  frame?: string
}

export interface SecCompanyFact {
  label?: string
  description?: string
  units?: Record<string, SecCompanyFactUnit[]>
}

export interface SecCompanyFacts {
  cik?: number
  entityName?: string
  facts?: Record<string, Record<string, SecCompanyFact>>
}

export class SecEdgarClient {
  private issuerIndex: Promise<Map<string, SecIssuer>> | null = null

  async resolveIssuer(ticker: string): Promise<SecIssuer> {
    const issuer = (await this.getIssuerIndex()).get(this.normalizeTicker(ticker))
    if (!issuer) throw new Error(`SEC 未找到美股代码 ${ticker}`)
    return issuer
  }

  getSubmissions(cik: number): Promise<SecSubmissions> {
    return this.getJson<SecSubmissions>(
      `${SEC_DATA_BASE_URL}/submissions/CIK${this.padCik(cik)}.json`
    )
  }

  getCompanyFacts(cik: number): Promise<SecCompanyFacts> {
    return this.getJson<SecCompanyFacts>(
      `${SEC_DATA_BASE_URL}/api/xbrl/companyfacts/CIK${this.padCik(cik)}.json`
    )
  }

  filingUrl(cik: number, accessionNumber: string, primaryDocument: string): string {
    return `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNumber.replaceAll('-', '')}/${primaryDocument}`
  }

  filingTextUrl(cik: number, accessionNumber: string): string {
    return `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNumber.replaceAll('-', '')}/${accessionNumber}.txt`
  }

  getFilingText(cik: number, accessionNumber: string): Promise<string> {
    return this.getText(this.filingTextUrl(cik, accessionNumber))
  }

  issuerPageUrl(cik: number): string {
    return `https://www.sec.gov/edgar/browse/?CIK=${cik}`
  }

  private getIssuerIndex(): Promise<Map<string, SecIssuer>> {
    if (!this.issuerIndex) {
      this.issuerIndex = this.getJson<{ fields?: string[]; data?: Array<Array<string | number>> }>(
        SEC_TICKERS_URL
      )
        .catch(async (error: unknown) => {
          if (!(error instanceof SecHttpError) || error.status !== 403) throw error
          const tickers =
            await this.getJson<Record<string, { cik_str: number; ticker: string; title: string }>>(
              SEC_TICKERS_FALLBACK_URL
            )
          return {
            fields: ['cik', 'name', 'ticker', 'exchange'],
            data: Object.values(tickers).map((item) => [item.cik_str, item.title, item.ticker, ''])
          }
        })
        .then((payload) => {
          const fields = payload.fields ?? []
          const cikIndex = fields.indexOf('cik')
          const nameIndex = fields.indexOf('name')
          const tickerIndex = fields.indexOf('ticker')
          const exchangeIndex = fields.indexOf('exchange')
          return new Map(
            (payload.data ?? []).flatMap((row): Array<[string, SecIssuer]> => {
              const ticker = String(row[tickerIndex] ?? '')
              const cik = Number(row[cikIndex])
              if (!ticker || !Number.isFinite(cik)) return []
              return [
                [
                  this.normalizeTicker(ticker),
                  {
                    cik,
                    name: String(row[nameIndex] ?? ticker),
                    ticker,
                    exchange: String(row[exchangeIndex] ?? '')
                  }
                ]
              ]
            })
          )
        })
        .catch((reason) => {
          this.issuerIndex = null
          throw reason
        })
    }
    return this.issuerIndex
  }

  private normalizeTicker(ticker: string): string {
    return ticker.trim().toUpperCase().replaceAll('.', '-').replaceAll('/', '-')
  }

  private padCik(cik: number): string {
    return String(cik).padStart(10, '0')
  }

  private async getJson<T>(url: string): Promise<T> {
    return JSON.parse(await this.requestText(url, SEC_HEADERS, 20_000, '请求 SEC EDGAR 失败')) as T
  }

  private async getText(url: string): Promise<string> {
    return this.requestText(url, SEC_DOCUMENT_HEADERS, 30_000, '请求 SEC EDGAR 披露正文失败')
  }

  private async requestText(
    url: string,
    headers: Record<string, string>,
    timeout: number,
    failureMessage: string
  ): Promise<string> {
    try {
      const { bytes } = await requestOfficialSourceBytes(url, { headers }, timeout)
      return new TextDecoder().decode(bytes)
    } catch (error) {
      if (error instanceof OfficialSourceHttpError)
        throw new SecHttpError(failureMessage, error.status)
      throw error
    }
  }
}
