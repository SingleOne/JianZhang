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

  it('distinguishes DeepSeek Flash from Pro and text-only releases', () => {
    expect(supportsImageUnderstanding('deepseek', 'deepseek-flash')).toBe(true)
    expect(supportsImageUnderstanding('deepseek', 'deepseek-v4-flash')).toBe(true)
    expect(supportsImageUnderstanding('deepseek', 'deepseek-v4-flash-vision-exp')).toBe(true)
    expect(supportsImageUnderstanding('deepseek', 'deepseek-v4-pro')).toBe(false)
    expect(supportsImageUnderstanding('deepseek', 'deepseek-v3.2')).toBe(false)
  })

  it('recognizes current and legacy GLM visual models', () => {
    expect(supportsImageUnderstanding('zhipu', 'glm-5.3-flash')).toBe(true)
    expect(supportsImageUnderstanding('zhipu', 'glm-5v-turbo')).toBe(true)
    expect(supportsImageUnderstanding('zhipu', 'glm-4.6v-flashx')).toBe(true)
    expect(supportsImageUnderstanding('zhipu', 'glm-5.2')).toBe(false)
  })

  it('distinguishes multimodal Kimi and MiniMax models', () => {
    expect(supportsImageUnderstanding('kimi', 'kimi-k3')).toBe(true)
    expect(supportsImageUnderstanding('kimi', 'kimi-k2.7-code-highspeed')).toBe(true)
    expect(supportsImageUnderstanding('kimi', 'kimi-k2.6')).toBe(true)
    expect(supportsImageUnderstanding('kimi', 'kimi-k2-thinking')).toBe(false)
    expect(supportsImageUnderstanding('minimax', 'MiniMax-M3')).toBe(true)
    expect(supportsImageUnderstanding('minimax', 'MiniMax-M2.7')).toBe(false)
  })

  it('distinguishes current Hy text and Hunyuan vision models', () => {
    expect(supportsImageUnderstanding('hunyuan', 'hy4-preview')).toBe(false)
    expect(supportsImageUnderstanding('hunyuan', 'hy3')).toBe(false)
    expect(supportsImageUnderstanding('hunyuan', 'hy-vision-2.0-instruct')).toBe(true)
    expect(supportsImageUnderstanding('hunyuan', 'hunyuan-vision-1.5-instruct')).toBe(true)
    expect(supportsImageUnderstanding('hunyuan', 'hunyuan-t1-vision-20250916')).toBe(true)
    expect(supportsImageUnderstanding('hunyuan', 'hunyuan-turbos-vision-video-20250728')).toBe(
      false
    )
  })

  it('distinguishes ERNIE visual and text-only releases', () => {
    expect(supportsImageUnderstanding('ernie', 'ernie-5.0')).toBe(true)
    expect(supportsImageUnderstanding('ernie', 'ernie-5.0-thinking-preview')).toBe(true)
    expect(supportsImageUnderstanding('ernie', 'ernie-4.5-turbo-vl')).toBe(true)
    expect(supportsImageUnderstanding('ernie', 'ernie-5.1')).toBe(false)
  })

  it('recognizes Qwen general multimodal and VL model families', () => {
    expect(supportsImageUnderstanding('qwen', 'qwen3.8-max')).toBe(true)
    expect(supportsImageUnderstanding('qwen', 'qwen3.8-27b')).toBe(true)
    expect(supportsImageUnderstanding('qwen', 'qwen3.5-plus')).toBe(true)
    expect(supportsImageUnderstanding('qwen', 'qwen3-vl-plus')).toBe(true)
    expect(supportsImageUnderstanding('qwen', 'qwen-vl-plus')).toBe(true)
    expect(supportsImageUnderstanding('qwen', 'qwen3-coder-plus')).toBe(false)
    expect(supportsImageUnderstanding('qwen', 'qwen3-vl-embedding')).toBe(false)
  })

  it('distinguishes MiMo multimodal and Pro models', () => {
    expect(supportsImageUnderstanding('mimo', 'mimo-v2.5')).toBe(true)
    expect(supportsImageUnderstanding('mimo', 'mimo-v2.5-pro')).toBe(false)
    expect(supportsImageUnderstanding('mimo', 'mimo-v2-flash')).toBe(false)
  })

  it('recognizes Grok 4 image-understanding models', () => {
    expect(supportsImageUnderstanding('grok', 'grok-4.6')).toBe(true)
    expect(supportsImageUnderstanding('grok', 'grok-4')).toBe(true)
    expect(supportsImageUnderstanding('grok', 'grok-3-mini')).toBe(false)
  })
})
