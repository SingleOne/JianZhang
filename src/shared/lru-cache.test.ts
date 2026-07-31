import { describe, expect, it } from 'vitest'
import { LruCache } from './lru-cache'

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const cache = new LruCache<string, number>(2)
    cache.set('first', 1)
    cache.set('second', 2)
    expect(cache.get('first')).toBe(1)

    cache.set('third', 3)

    expect(cache.get('second')).toBeUndefined()
    expect(cache.get('first')).toBe(1)
    expect(cache.get('third')).toBe(3)
    expect(cache.size).toBe(2)
  })

  it('updates an existing value without increasing its size', () => {
    const cache = new LruCache<string, number>(1)
    cache.set('key', 1)
    cache.set('key', 2)
    expect(cache.get('key')).toBe(2)
    expect(cache.size).toBe(1)
  })

  it('requires a positive capacity', () => {
    expect(() => new LruCache(0)).toThrow('容量必须大于0')
  })
})
