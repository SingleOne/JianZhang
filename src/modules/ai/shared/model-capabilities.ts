import type { AiProviderId } from './types'

// 仅放行厂商官方文档明确支持图片理解的模型；未核对的新型号默认按不支持处理。
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

function deepSeekSupportsImageUnderstanding(model: string): boolean {
  const id = normalizeModelId(model).replace(/^deepseek\//, '')
  return /^deepseek-(?:v4(?:\.1)?-)?flash(?:-|$)/.test(id)
}

function zhipuSupportsImageUnderstanding(model: string): boolean {
  const id = normalizeModelId(model)
  return (
    /^glm-5\.3-flash(?:-|$)/.test(id) ||
    /^glm-5v(?:-|$)/.test(id) ||
    /^glm-4(?:\.\d+)?v(?:-|$)/.test(id)
  )
}

function kimiSupportsImageUnderstanding(model: string): boolean {
  const id = normalizeModelId(model).replace(/^(?:moonshot|kimi)\//, '')
  return (
    /^kimi-k3(?:-|$)/.test(id) ||
    /^kimi-k2\.(?:5|6)(?:-|$)/.test(id) ||
    /^kimi-k2\.7-code(?:-|$)/.test(id) ||
    /^moonshot-v1-(?:8k|32k|128k)-vision-preview(?:-|$)/.test(id)
  )
}

function minimaxSupportsImageUnderstanding(model: string): boolean {
  return /^minimax-m3(?:-|$)/.test(normalizeModelId(model))
}

function hunyuanSupportsImageUnderstanding(model: string): boolean {
  const id = normalizeModelId(model)
  return (
    /^hy-vision-(?:1\.5|2\.0)-(?:instruct|thinking)(?:-|$)/.test(id) ||
    /^hunyuan-(?:vision|t1-vision)(?:-|$)/.test(id)
  )
}

function ernieSupportsImageUnderstanding(model: string): boolean {
  const id = normalizeModelId(model)
  return /^ernie-5\.0(?:-|$)/.test(id) || /^ernie-4\.5-(?:turbo-)?vl(?:-|$)/.test(id)
}

function qwenSupportsImageUnderstanding(model: string): boolean {
  const id = normalizeModelId(model).replace(/^qwen\//, '')
  if (/(?:embedding|rerank|image|tts|asr|speech)/.test(id)) return false
  return (
    /^qwen3\.[5-8]-(?:max|plus|flash|omni|ocr|\d+b)(?:-|$)/.test(id) ||
    /^qwen(?:2\.5|3)-vl(?:-|$)/.test(id) ||
    /^qwen(?:3)?-omni(?:-|$)/.test(id) ||
    /^qwen-vl(?:-|$)/.test(id) ||
    /^qvq-(?:max|plus)(?:-|$)/.test(id) ||
    /^gui-plus(?:-|$)/.test(id)
  )
}

function mimoSupportsImageUnderstanding(model: string): boolean {
  const id = normalizeModelId(model)
  return /^mimo-v2\.5(?:-\d{4,8})?$/.test(id)
}

function grokSupportsImageUnderstanding(model: string): boolean {
  return /^grok-4(?:[.-]|$)/.test(normalizeModelId(model))
}

export function supportsImageUnderstanding(providerId: AiProviderId, model: string): boolean {
  if (providerId === 'openai') return openAiSupportsImageUnderstanding(model)
  if (providerId === 'deepseek') return deepSeekSupportsImageUnderstanding(model)
  if (providerId === 'zhipu') return zhipuSupportsImageUnderstanding(model)
  if (providerId === 'kimi') return kimiSupportsImageUnderstanding(model)
  if (providerId === 'minimax') return minimaxSupportsImageUnderstanding(model)
  if (providerId === 'hunyuan') return hunyuanSupportsImageUnderstanding(model)
  if (providerId === 'ernie') return ernieSupportsImageUnderstanding(model)
  if (providerId === 'qwen') return qwenSupportsImageUnderstanding(model)
  if (providerId === 'mimo') return mimoSupportsImageUnderstanding(model)
  if (providerId === 'grok') return grokSupportsImageUnderstanding(model)
  if (providerId === 'gemini') return geminiSupportsImageUnderstanding(model)
  if (providerId === 'anthropic') return anthropicSupportsImageUnderstanding(model)
  return false
}
