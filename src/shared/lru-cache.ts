export class LruCache<Key, Value> {
  private readonly entries = new Map<Key, Value>()

  constructor(private readonly maxEntries: number) {
    if (maxEntries < 1) throw new Error('LRU缓存容量必须大于0')
  }

  get size(): number {
    return this.entries.size
  }

  has(key: Key): boolean {
    return this.entries.has(key)
  }

  get(key: Key): Value | undefined {
    const value = this.entries.get(key)
    if (value === undefined) return undefined
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  set(key: Key, value: Value): void {
    this.entries.delete(key)
    this.entries.set(key, value)
    if (this.entries.size <= this.maxEntries) return
    const oldest = this.entries.keys().next()
    if (!oldest.done) this.entries.delete(oldest.value)
  }

  delete(key: Key): boolean {
    return this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }
}
