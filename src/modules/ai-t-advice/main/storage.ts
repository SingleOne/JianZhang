import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiTAdvice, AiTAdviceSettings } from '../shared/types'

const DEFAULT_SETTINGS: AiTAdviceSettings = { enabled: true }

export class AiTAdviceStorage {
  private readonly settingsPath: string
  private readonly historyPath: string

  constructor(readonly rootDirectory: string) {
    mkdirSync(rootDirectory, { recursive: true })
    this.settingsPath = join(rootDirectory, 'settings.json')
    this.historyPath = join(rootDirectory, 'advice-history.jsonl')
  }

  getSettings(): AiTAdviceSettings {
    try {
      const saved = JSON.parse(readFileSync(this.settingsPath, 'utf8')) as Partial<AiTAdviceSettings>
      return { enabled: saved.enabled !== false }
    } catch {
      return DEFAULT_SETTINGS
    }
  }

  saveSettings(settings: AiTAdviceSettings): AiTAdviceSettings {
    writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), 'utf8')
    return settings
  }

  listHistory(quoteId?: string): AiTAdvice[] {
    if (!existsSync(this.historyPath)) return []
    const records = readFileSync(this.historyPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AiTAdvice)
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
    return advice
  }
}
