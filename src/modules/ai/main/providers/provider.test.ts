import { describe, expect, it } from 'vitest'
import { parseModelOptions } from './provider'

describe('parseModelOptions', () => {
  it('normalizes OpenAI, Gemini, and Model Studio model lists', () => {
    expect(
      parseModelOptions({
        data: [{ id: 'gpt-example' }]
      })
    ).toEqual([{ id: 'gpt-example', label: 'gpt-example' }])

    expect(
      parseModelOptions({
        models: [{ name: 'models/gemini-example', displayName: 'Gemini Example' }]
      })
    ).toEqual([{ id: 'gemini-example', label: 'Gemini Example' }])

    expect(
      parseModelOptions({
        output: {
          models: [{ model: 'qwen-example', name: 'Qwen Example' }]
        }
      })
    ).toEqual([{ id: 'qwen-example', label: 'Qwen Example' }])
  })
})
