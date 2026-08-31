import { net } from 'electron'

const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers_exchange.json'
const SEC_DATA_BASE_URL = 'https://data.sec.gov'
const SEC_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'JianZhang Desktop stock research app'
}
const SEC_DOCUMENT_HEADERS = {
  Accept: 'text/plain, text/html, */*',
  'User-Agent': 'JianZhang Desktop stock research app'
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
    const response = await net.fetch(url, {
      headers: SEC_HEADERS,
      signal: AbortSignal.timeout(20_000)
    })
    if (!response.ok) throw new Error(`请求 SEC EDGAR 失败：HTTP ${response.status}`)
    return response.json() as Promise<T>
  }

  private async getText(url: string): Promise<string> {
    const response = await net.fetch(url, {
      headers: SEC_DOCUMENT_HEADERS,
      signal: AbortSignal.timeout(30_000)
    })
    if (!response.ok) throw new Error(`请求 SEC EDGAR 披露正文失败：HTTP ${response.status}`)
    return response.text()
  }
}
