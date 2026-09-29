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
  capabilities?: MemoryCapabilities
}

export interface MemoryCapabilities {
  apiVersion: string
  schemaVersion?: number
  profile: boolean
  sessions: boolean
  documentLibrary?: boolean
  documentJobs?: boolean
  ocrAvailable?: boolean
  ocrLanguages?: string[]
  ocrModes?: string[]
  vectorBackend?: string
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

export interface MemoryMaintenanceStatus {
  configuration: 'ready' | 'unconfigured' | 'invalid'
  enabled: boolean
  jobs: Record<string, number>
  pendingCandidates: number
  session: {
    summary: string
    summaryThrough: number
    lastSequence: number
    state: 'idle' | 'pending' | 'running' | 'failed'
    attempts: number
    lastError: string | null
  } | null
}

export interface MemoryCandidate {
  id: string
  key: string
  content: string
  category: string
  evidence: string
  revision: number
  createdAt: string
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
  publishedGenerationId?: string | null
  createdAt: string
  publishedAt: string | null
}

export type MemoryDocumentJobState =
  | 'queued'
  | 'running'
  | 'retry_wait'
  | 'needs_action'
  | 'failed'
  | 'succeeded'
  | 'cancelled'
  | 'superseded'

export type MemoryDocumentJobStage =
  'staging' | 'parsing' | 'ocr' | 'chunking' | 'keyword_index' | 'embedding' | 'publishing'

export interface MemoryDocumentProcessingJob {
  id: string
  documentId: string
  versionId: string
  generationId: string
  kind: 'reindex' | 'embed'
  parameters: Record<string, string | number | boolean | null>
  expectedDocumentRevision: number
  state: MemoryDocumentJobState
  stage: MemoryDocumentJobStage
  progress: { completed: number | null; total: number | null }
  attempts: number
  maxAttempts: number
  retryAt: string | null
  error: {
    code: string
    message: string | null
    retryable: boolean
    actionHint: string | null
  } | null
  result: {
    generationId?: string
    versionId?: string
    documentRevision?: number
    status?: 'ready' | 'keyword_ready'
    publishedAt?: string
  } | null
  jobRevision: number
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
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
