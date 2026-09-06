import type { AiConnectionResult, AiModelOption, AiProviderTurnResult } from '../../shared/types'

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
  if (status === 401 || status === 403)
    return { ok: false, kind: 'authentication', message: '认证失败，请检查 API Key' }
  if (status === 429)
    return { ok: false, kind: 'rate_limit', message: '请求受限，请稍后重试或检查额度' }
  if (error instanceof TypeError)
    return { ok: false, kind: 'network', message: '网络连接失败，请检查网络后重试' }
  return {
    ok: false,
    kind: 'provider',
    message: error instanceof Error ? error.message : 'Provider 连接失败'
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function modelEntries(value: unknown): unknown[] {
  const root = record(value)
  if (!root) return []
  if (Array.isArray(root.data)) return root.data
  if (Array.isArray(root.models)) return root.models
  const output = record(root.output)
  return Array.isArray(output?.models) ? output.models : []
}

export function parseModelOptions(value: unknown): AiModelOption[] {
  const models = new Map<string, AiModelOption>()
  for (const entry of modelEntries(value)) {
    const model = record(entry)
    if (!model) continue
    const rawId = [model.id, model.model, model.name].find(
      (candidate) => typeof candidate === 'string' && candidate.trim()
    )
    if (typeof rawId !== 'string') continue
    const id = rawId.trim().replace(/^models\//, '')
    const rawLabel = [model.display_name, model.displayName, model.label, model.name].find(
      (candidate) => typeof candidate === 'string' && candidate.trim()
    )
    const label = typeof rawLabel === 'string' ? rawLabel.trim().replace(/^models\//, '') : id
    if (!models.has(id)) models.set(id, { id, label })
  }
  return [...models.values()].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: 'base' })
  )
}

export async function fetchModelOptions(
  url: string,
  headers: Record<string, string>
): Promise<AiModelOption[]> {
  const response = await fetch(url, { headers })
  await ensureResponse(response)
  return parseModelOptions(await response.json())
}

export async function readSse(response: Response, onData: (data: string) => void): Promise<void> {
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
