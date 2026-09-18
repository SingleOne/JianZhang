import { describe, expect, it } from 'vitest'
import { supportsImageUnderstanding } from './model-capabilities'

describe('supportsImageUnderstanding', () => {
  it('distinguishes OpenAI vision and text-only models', () => {
    expect(supportsImageUnderstanding('openai', 'gpt-5.6')).toBe(true)
    expect(supportsImageUnderstanding('openai', 'gpt-4o-mini')).toBe(true)
    expect(supportsImageUnderstanding('openai', 'o3')).toBe(true)
    expect(supportsImageUnderstanding('openai', 'o4-mini')).toBe(true)
    expect(supportsImageUnderstanding('openai', 'o3-mini')).toBe(false)
    expect(supportsImageUnderstanding('openai', 'gpt-3.5-turbo')).toBe(false)
  })

  it('accepts general Gemini models but rejects specialized non-vision chat models', () => {
    expect(supportsImageUnderstanding('gemini', 'gemini-3.5-flash')).toBe(true)
    expect(supportsImageUnderstanding('gemini', 'gemini-2.5-pro')).toBe(true)
    expect(supportsImageUnderstanding('gemini', 'gemini-3.1-flash-tts-preview')).toBe(false)
    expect(supportsImageUnderstanding('gemini', 'gemini-3-pro-image')).toBe(false)
    expect(supportsImageUnderstanding('gemini', 'gemini-1.0-pro')).toBe(false)
  })

  it('accepts Claude 3 and newer model identifiers', () => {
    expect(supportsImageUnderstanding('anthropic', 'claude-3-5-sonnet-20241022')).toBe(true)
    expect(supportsImageUnderstanding('anthropic', 'claude-sonnet-5')).toBe(true)
    expect(supportsImageUnderstanding('anthropic', 'claude-2.1')).toBe(false)
  })

  it('keeps text-only provider adapters disabled', () => {
    expect(supportsImageUnderstanding('deepseek', 'deepseek-v4-flash')).toBe(false)
    expect(supportsImageUnderstanding('qwen', 'qwen3.8-max')).toBe(false)
  })
})
