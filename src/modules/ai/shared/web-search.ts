import type { AiCredentialStatus, AiProviderId } from './types'

export type AiWebSearchBackend = 'deepseek' | 'kimi' | 'minimax' | 'grok'

export function getWebSearchBackend(
  providerId: AiProviderId,
  credentials: Partial<Record<AiProviderId, AiCredentialStatus>>
): AiWebSearchBackend | undefined {
  if (
    (providerId === 'kimi' || providerId === 'minimax' || providerId === 'grok') &&
    credentials[providerId]?.configured
  )
    return providerId
  return credentials.deepseek?.configured ? 'deepseek' : undefined
}
