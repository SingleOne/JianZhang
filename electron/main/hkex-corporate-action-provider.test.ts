import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  net: { fetch: vi.fn() }
}))

import { HkexCorporateActionProvider } from './hkex-corporate-action-provider'

describe('HkexCorporateActionProvider', () => {
  it('passes each HKEX second-tier group code with its category', async () => {
    const client = {
      resolveStock: vi.fn(async () => ({ stockId: 190371, code: '01810', name: 'XIAOMI-W' })),
      search: vi.fn(async (..._args: [number, string, string, string, string?, string?]) => [])
    }

    await new HkexCorporateActionProvider(client).fetch('116.01810')

    expect(client.search.mock.calls.map((call) => [call[4], call[5]])).toEqual([
      ['13250', '3'],
      ['13251', '3'],
      ['18120', '8'],
      ['18140', '8'],
      ['18500', '8'],
      ['18460', '8'],
      ['12700', '2'],
      ['17450', '7'],
      ['17700', '7'],
      ['17600', '7'],
      ['18260', '8']
    ])
  })
})
