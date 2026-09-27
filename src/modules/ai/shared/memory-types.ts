export interface MemoryIdentity {
  serviceId: string
  userId: string
  clientId: string
  agentId: string
  displayName: string
  scopes: string[]
}

export interface MemoryProfile {
  id: string
  name: string
  url: string
  serviceId: string
  userId: string
  clientId: string
  displayName: string
}

export interface MemoryFact {
  id: string
  key: string
  content: string
  category: string
  pinned: boolean
  revision: number
  source?: string
  updatedAt: string
}

export interface MemoryStatus {
  activeProfileId: string | null
  profiles: MemoryProfile[]
  pendingDeletes: number
  bindings: Record<
    string,
    { profileId: string; pendingDelete: boolean; historyVisible: boolean; libraryIds: string[] }
  >
}

export interface MemorySearchResult {
  kind: 'fact' | 'message' | 'document'
  sourceId: string
  text: string
  score: number
  key?: string
  title?: string
  role?: string
  occurredAt?: string
  documentId?: string
  versionId?: string
  libraryId?: string
  fileName?: string
  versionNo?: number
  locator?: string
  heading?: string
}

export interface MemoryLibrary {
  id: string
  name: string
  revision: number
  documentCount: number
  createdAt: string
}

export interface MemoryDocumentVersion {
  id: string
  versionNo: number
  name: string
  status: 'ready' | 'keyword_ready' | 'embedding_failed' | 'needs_ocr'
  error: string | null
  mime: string
  size: number
  pageCount: number | null
  modelFingerprint: string | null
  createdAt: string
  publishedAt: string | null
}

export interface MemoryDocument {
  id: string
  libraryId: string
  name: string
  revision: number
  activeVersion: MemoryDocumentVersion | null
  latestVersion: MemoryDocumentVersion | null
  createdAt: string
  updatedAt: string
}

export interface MemorySourceDetail {
  kind: 'fact' | 'message' | 'document'
  sourceId: string
  text: string
  fileName?: string
  versionNo?: number
  locator?: string
  heading?: string
}
