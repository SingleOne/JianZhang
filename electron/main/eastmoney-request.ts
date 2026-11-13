import { eastmoneyHistorySession } from './eastmoney-history-session'
import { hasEastmoneyChallenge, hasEastmoneyResponseData } from './eastmoney-verification'

export async function fetchEastmoney(url: string, init?: RequestInit): Promise<Response> {
  if (eastmoneyHistorySession.verification.required) {
    throw new Error('东方财富正在等待手动安全验证')
  }
  try {
    const browserSession = await eastmoneyHistorySession.getSession()
    return await browserSession.fetch(url, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(12_000),
      credentials: 'include'
    })
  } catch (error) {
    eastmoneyHistorySession.verification.check(url)
    throw error
  }
}

export function parseEastmoneyJson<T>(
  url: string,
  status: number,
  text: string,
  responseUrl?: string,
  checkEmpty = true
): T {
  if (hasEastmoneyChallenge(text)) {
    eastmoneyHistorySession.verification.check(url, true, responseUrl)
    throw new Error('东方财富需要手动安全验证')
  }
  try {
    if (status < 200 || status >= 300) throw new Error(`行情服务返回 ${status}`)
    const payload = JSON.parse(text) as T
    if (checkEmpty && !hasEastmoneyResponseData(payload))
      eastmoneyHistorySession.verification.check(url)
    return payload
  } catch (error) {
    eastmoneyHistorySession.verification.check(url)
    throw error
  }
}

export async function readEastmoneyJson<T>(
  response: Response,
  url: string,
  checkEmpty = true
): Promise<T> {
  let text: string
  try {
    text = await response.text()
  } catch (error) {
    eastmoneyHistorySession.verification.check(url)
    throw error
  }
  return parseEastmoneyJson<T>(url, response.status, text, response.url, checkEmpty)
}
