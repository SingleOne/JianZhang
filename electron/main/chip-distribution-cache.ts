import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChipDistributionCacheEntry } from '../../src/shared/types'

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

  save(entry: ChipDistributionCacheEntry): ChipDistributionCacheEntry {
    this.entries[entry.quoteId] = entry
    const file: ChipDistributionCacheFile = { version: 1, entries: this.entries }
    writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf8')
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
