import { useCallback, type SetStateAction } from 'react'
import { dataCenter } from '../api'
import { useDetailResource } from './detail-hooks'
import type { DetailResource } from './resource'
import type { AiApi } from '../../modules/ai/shared/types'

/** A write must not join a read that started before it was committed. */
export function reloadMemoryResource<T>(resource: DetailResource<T>) {
  const current = resource.getSnapshot().data
  // Keep the visible profile and its child workflows mounted while rereading metadata.
  if (current === undefined) resource.invalidate()
  else resource.update(current)
  return resource.request(true)
}

let identityVersion = 0
let identityChange: Promise<unknown> | undefined
const get = <T>(key: string[], load: () => Promise<T>) =>
  dataCenter.details.resource(
    JSON.stringify(['memory', key[0] === 'status' ? 0 : identityVersion, ...key]),
    load,
    {
      category: 'ai-memory',
      quoteId: '',
      maxAge: 0
    }
  )
export const memoryStatusResource = (api: AiApi) =>
  get(['status'], async () => {
    // A finishing child workflow may request metadata while the parent is switching identity.
    await identityChange?.catch(() => undefined)
    return api.getMemoryStatus()
  })

/** Retired identity keys cannot be reused by late uploads/queries after switching back. */
export async function changeMemoryIdentity<T>(api: AiApi, change: () => Promise<T>): Promise<T> {
  const pending = Promise.resolve().then(change)
  identityChange = pending
  identityVersion += 1
  dataCenter.details.invalidate(undefined, ['ai-memory'])
  try {
    return await pending
  } finally {
    if (identityChange === pending) identityChange = undefined
    await memoryStatusResource(api).request(true)
  }
}
export const memoryFactsResource = (api: AiApi, profileId: string) =>
  get(['facts', profileId], () => api.listMemoryFacts())
export const memoryLibrariesResource = (api: AiApi, profileId: string) =>
  get(['libraries', profileId], () => api.listMemoryLibraries())
export const memoryDocumentsResource = (api: AiApi, profileId: string, libraryId: string) =>
  get(['documents', profileId, libraryId], () => api.listMemoryDocuments(libraryId))
export const memoryJobsResource = (api: AiApi, profileId: string, libraryId: string) =>
  get(['jobs', profileId, libraryId], async () => {
    const documents = await memoryDocumentsResource(api, profileId, libraryId).request()
    const results = await Promise.allSettled(
      documents.map((item) => api.listMemoryDocumentJobs(item.id))
    )
    return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  })
export const memoryMaintenanceResource = (api: AiApi, profileId: string, conversationId?: string) =>
  get(['maintenance', profileId, conversationId ?? ''], () =>
    api.getMemoryMaintenanceStatus(conversationId)
  )
export const memoryCandidatesResource = (api: AiApi, profileId: string) =>
  get(['candidates', profileId], () => api.listMemoryCandidates())

/** Workflows control when to fetch; their accepted responses live in the shared resource. */
export function useResourceValue<T>(resource: DetailResource<T>, initial: T) {
  const { data } = useDetailResource(resource, false)
  const set = useCallback(
    (value: SetStateAction<T>) => {
      const current = resource.getSnapshot().data ?? initial
      const next = value instanceof Function ? value(current) : value
      if (next !== resource.getSnapshot().data) resource.update(next)
    },
    [resource, initial]
  )
  return [data ?? initial, set] as const
}
