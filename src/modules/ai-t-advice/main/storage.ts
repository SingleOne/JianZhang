import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiTAdvice, AiTAdviceSettings } from '../shared/types'
import {
  atomicWriteJsonLinesSync,
  atomicWriteJsonSync,
  readJsonLinesSync
} from '../../../../electron/main/file-storage'

const DEFAULT_SETTINGS: AiTAdviceSettings = { enabled: true }
const HISTORY_COMPACTION_THRESHOLD = 300
const HISTORY_RETENTION = 200

export class AiTAdviceStorage {
  private readonly settingsPath: string
  private readonly historyPath: string
  private historyRecordCount = 0

  constructor(readonly rootDirectory: string) {
    mkdirSync(rootDirectory, { recursive: true })
    this.settingsPath = join(rootDirectory, 'settings.json')
    this.historyPath = join(rootDirectory, 'advice-history.jsonl')
    if (existsSync(this.historyPath)) this.repairAndCompactHistory()
  }

  getSettings(): AiTAdviceSettings {
    try {
      const saved = JSON.parse(
        readFileSync(this.settingsPath, 'utf8')
      ) as Partial<AiTAdviceSettings>
      return { enabled: saved.enabled !== false }
    } catch {
      return DEFAULT_SETTINGS
    }
  }

  saveSettings(settings: AiTAdviceSettings): AiTAdviceSettings {
    atomicWriteJsonSync(this.settingsPath, settings)
    return settings
  }

  listHistory(quoteId?: string): AiTAdvice[] {
    if (!existsSync(this.historyPath)) return []
    const { records } = readJsonLinesSync<AiTAdvice>(this.historyPath)
    const latestById = new Map<string, AiTAdvice>()
    for (const record of records) latestById.set(record.id, record)
    return [...latestById.values()]
      .filter((item) => !quoteId || item.quoteId === quoteId)
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
      .slice(0, 100)
  }

  getAdvice(adviceId: string): AiTAdvice | null {
    return this.listHistory().find((item) => item.id === adviceId) ?? null
  }

  saveAdvice(advice: AiTAdvice): AiTAdvice {
    appendFileSync(this.historyPath, `${JSON.stringify(advice)}\n`, 'utf8')
    this.historyRecordCount += 1
    if (this.historyRecordCount > HISTORY_COMPACTION_THRESHOLD) this.repairAndCompactHistory()
    return advice
  }

  private repairAndCompactHistory(): void {
    const { records, invalidLineCount } = readJsonLinesSync<AiTAdvice>(this.historyPath)
    if (records.length <= HISTORY_COMPACTION_THRESHOLD && invalidLineCount === 0) {
      this.historyRecordCount = records.length
      return
    }
    const latestById = new Map<string, AiTAdvice>()
    for (const record of records) latestById.set(record.id, record)
    const compacted = [...latestById.values()]
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
      .slice(0, HISTORY_RETENTION)
      .reverse()
    atomicWriteJsonLinesSync(this.historyPath, compacted)
    this.historyRecordCount = compacted.length
  }
}
