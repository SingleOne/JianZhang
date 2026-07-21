import type { AiConnectionResult, AiProviderTurnResult } from '../../shared/types'

export async function ensureResponse(response: Response): Promise<void> {
  if (response.ok) return
  const body = await response.text()
  const message = body ? body.slice(0, 300) : `HTTP ${response.status}`
  const error = new Error(message) as Error & { status?: number }
  error.status = response.status
  throw error
}

export function connectionResultFromError(error: unknown): AiConnectionResult {
  const status = error instanceof Error && 'status' in error ? Number(error.status) : undefined
  if (status === 401 || status === 403) return { ok: false, kind: 'authentication', message: '认证失败，请检查 API Key' }
  if (status === 429) return { ok: false, kind: 'rate_limit', message: '请求受限，请稍后重试或检查额度' }
  if (error instanceof TypeError) return { ok: false, kind: 'network', message: '网络连接失败，请检查网络后重试' }
  return { ok: false, kind: 'provider', message: error instanceof Error ? error.message : 'Provider 连接失败' }
}

export async function readSse(
  response: Response,
  onData: (data: string) => void
): Promise<void> {
  if (!response.body) throw new Error('Provider 未返回流式响应')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let separator = buffer.indexOf('\n\n')
    while (separator !== -1) {
      const event = buffer.slice(0, separator)
      buffer = buffer.slice(separator + 2)
      const payload = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (payload) onData(payload)
      separator = buffer.indexOf('\n\n')
    }
  }

  const payload = buffer
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (payload) onData(payload)
}

export function completed(content: string, responseId?: string): AiProviderTurnResult {
  return { content, responseId }
}
