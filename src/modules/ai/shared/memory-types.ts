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
  bindings: Record<string, { profileId: string; pendingDelete: boolean; historyVisible: boolean }>
}

export interface MemorySearchResult {
  kind: 'fact' | 'message'
  sourceId: string
  text: string
  score: number
  key?: string
  title?: string
  role?: string
  occurredAt?: string
}
