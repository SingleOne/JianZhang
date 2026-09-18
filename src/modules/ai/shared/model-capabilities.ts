import type { AiProviderId } from './types'

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase()
}

function openAiSupportsImageUnderstanding(model: string): boolean {
  const id = normalizeModelId(model)
  if (
    /(?:audio|realtime|transcribe|tts|embedding|moderation|search|image|deep-research)/.test(id)
  ) {
    return false
  }
  if (
    /^gpt-(?:[5-9](?:[.-]|$)|4o(?:-|$)|4\.1(?:-|$)|4\.5(?:-|$)|4-turbo(?:-|$)|4-vision(?:-|$))/.test(
      id
    )
  ) {
    return true
  }
  if (/^chatgpt-4o(?:-|$)/.test(id)) return true
  if (/^o1-(?:mini|preview)(?:-|$)/.test(id) || /^o3-mini(?:-|$)/.test(id)) return false
  return /^(?:o1(?:-pro)?|o3(?:-pro)?|o4-mini)(?:-|$)/.test(id)
}

function geminiSupportsImageUnderstanding(model: string): boolean {
  const id = normalizeModelId(model).replace(/^models\//, '')
  if (!id.startsWith('gemini-')) return false
  if (
    /(?:embedding|transcribe|tts|live|native-audio|robotics|computer-use|deep-research|-image(?:-|$))/.test(
      id
    )
  ) {
    return false
  }
  if (/^gemini-(?:1\.0-)?pro(?:-latest)?$/.test(id)) return false
  return true
}

function anthropicSupportsImageUnderstanding(model: string): boolean {
  const id = normalizeModelId(model)
  return (
    /^claude-3(?:-|$)/.test(id) ||
    /^claude-(?:opus|sonnet|haiku|fable|mythos)-(?:[3-9])(?:-|$)/.test(id)
  )
}

export function supportsImageUnderstanding(providerId: AiProviderId, model: string): boolean {
  if (providerId === 'openai') return openAiSupportsImageUnderstanding(model)
  if (providerId === 'gemini') return geminiSupportsImageUnderstanding(model)
  if (providerId === 'anthropic') return anthropicSupportsImageUnderstanding(model)
  return false
}
