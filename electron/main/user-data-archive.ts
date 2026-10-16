import { createHash } from 'node:crypto'

export interface UserDataArchiveMetadata {
  version: string
  generatedAt: string
}

export function getUserDataArchiveMetadata(content: string): UserDataArchiveMetadata {
  const document = JSON.parse(content) as { exportedAt?: string; applicationVersion?: string }
  // Generation time and application updates do not create a new data version.
  const payload = { ...document, exportedAt: undefined, applicationVersion: undefined }
  const canonicalContent = JSON.stringify(payload, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]])
        )
      : value
  )
  return {
    version: createHash('sha256').update(canonicalContent, 'utf8').digest('hex'),
    generatedAt: document.exportedAt ?? new Date().toISOString()
  }
}
