import { describe, expect, it } from 'vitest'
import { addOfficialModelDescriptions, getOfficialModelDescription } from './model-descriptions'

describe('official model descriptions', () => {
  it('returns official descriptions for current default models', () => {
    expect(getOfficialModelDescription('openai', 'gpt-5.6')).toContain('复杂专业工作')
    expect(getOfficialModelDescription('deepseek', 'deepseek-flash')).toContain('图片输入')
    expect(getOfficialModelDescription('zhipu', 'glm-5.3-flash')).toContain('原生多模态')
    expect(getOfficialModelDescription('kimi', 'kimi-k3')).toContain('1M 上下文')
    expect(getOfficialModelDescription('minimax', 'MiniMax-M2.7')).toContain('自我改进')
    expect(getOfficialModelDescription('hunyuan', 'hy4-preview')).toContain('复杂任务')
    expect(getOfficialModelDescription('ernie', 'ernie-5.1')).toContain('深度搜索')
    expect(getOfficialModelDescription('qwen', 'qwen3.8-max')).toContain('视觉理解')
    expect(getOfficialModelDescription('mimo', 'mimo-v2.5-pro')).toContain('长程推理')
    expect(getOfficialModelDescription('grok', 'grok-4.6')).toContain('知识工作')
    expect(getOfficialModelDescription('gemini', 'gemini-3.5-flash')).toContain('智能体')
    expect(getOfficialModelDescription('anthropic', 'claude-sonnet-5')).toContain('速度与智能')
  })

  it('prefers the official description returned by the provider API', () => {
    expect(
      addOfficialModelDescriptions('gemini', [
        { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', description: 'API description' }
      ])
    ).toEqual([
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', description: 'API description' }
    ])
  })

  it('marks unverified models instead of inventing a description', () => {
    expect(
      addOfficialModelDescriptions('openai', [{ id: 'future-model', label: 'Future' }])
    ).toEqual([{ id: 'future-model', label: 'Future', description: '官方模型列表未提供描述' }])
  })
})
