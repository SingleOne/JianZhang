import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChipDistributionCacheEntry } from '../../src/shared/types'
import { atomicWriteJsonSync } from './file-storage'

interface ChipDistributionCacheFile {
  version: 1
  entries: Record<string, ChipDistributionCacheEntry>
}

export class ChipDistributionCache {
  private readonly filePath: string
  private readonly entries: Record<string, ChipDistributionCacheEntry>

  constructor(rootDirectory: string) {
    mkdirSync(rootDirectory, { recursive: true })
    this.filePath = join(rootDirectory, 'chip-distributions.json')
    this.entries = this.load()
  }

  get(quoteId: string): ChipDistributionCacheEntry | null {
    return this.entries[quoteId] ?? null
  }

  clear(quoteId: string): void {
    if (!(quoteId in this.entries)) return
    delete this.entries[quoteId]
    atomicWriteJsonSync(this.filePath, { version: 1, entries: this.entries })
  }

  save(entry: ChipDistributionCacheEntry): ChipDistributionCacheEntry {
    this.entries[entry.quoteId] = entry
    const file: ChipDistributionCacheFile = { version: 1, entries: this.entries }
    atomicWriteJsonSync(this.filePath, file)
    return entry
  }

  private load(): Record<string, ChipDistributionCacheEntry> {
    try {
      const file = JSON.parse(readFileSync(this.filePath, 'utf8')) as ChipDistributionCacheFile
      return file.version === 1 && file.entries ? file.entries : {}
    } catch {
      return {}
    }
  }
}
