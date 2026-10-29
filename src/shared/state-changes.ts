import type { AppState, BootstrapResult, StockDesktopApi, StockTrackingArchiveIndex } from './types'

/** Changes contain only modified branches of the JSON-compatible application state. */
export type StatePatch =
  | { kind: 'value'; value: unknown }
  | { kind: 'object'; fields: Record<string, StatePatch>; removed: string[] }
  | { kind: 'array'; items: Record<string, StatePatch>; length: number }

export interface AppStateUpdate {
  baseRevision: number
  revision: number
  patch: StatePatch | null
}

export type BootstrapSyncResult = Omit<BootstrapResult, 'state'> & { state?: AppState }

export type StockDesktopBridge = Omit<
  StockDesktopApi,
  'getBootstrap' | 'saveState' | 'onStateUpdated' | 'archiveStockTrackingCycle' | 'exportConfig'
> & {
  getBootstrap: (knownRevision?: number) => Promise<BootstrapSyncResult>
  saveStateChanges: (update: AppStateUpdate) => Promise<AppStateUpdate>
  onStateChanged: (callback: (update: AppStateUpdate) => void) => () => void
  archiveStockTrackingCycle: (
    update: AppStateUpdate,
    profile: Parameters<StockDesktopApi['archiveStockTrackingCycle']>[1],
    deletePreviousArchives: boolean
  ) => Promise<{ update: AppStateUpdate; archiveIndex: StockTrackingArchiveIndex }>
  exportConfig: () => ReturnType<StockDesktopApi['exportConfig']>
}

export function createStatePatch(previous: unknown, next: unknown): StatePatch | null {
  if (Object.is(previous, next)) return null
  if (Array.isArray(previous) && Array.isArray(next)) {
    const items: Record<string, StatePatch> = {}
    for (let index = 0; index < next.length; index += 1) {
      const patch = createStatePatch(previous[index], next[index])
      if (patch) items[index] = patch
    }
    return previous.length === next.length && Object.keys(items).length === 0
      ? null
      : { kind: 'array', items, length: next.length }
  }
  if (
    previous !== null &&
    next !== null &&
    typeof previous === 'object' &&
    typeof next === 'object' &&
    !Array.isArray(previous) &&
    !Array.isArray(next)
  ) {
    const before = previous as Record<string, unknown>
    const after = next as Record<string, unknown>
    const fields = Object.fromEntries(
      Object.keys(after).flatMap((key) => {
        const patch = Object.hasOwn(before, key)
          ? createStatePatch(before[key], after[key])
          : { kind: 'value' as const, value: after[key] }
        return patch ? [[key, patch]] : []
      })
    )
    const removed = Object.keys(before).filter((key) => !Object.hasOwn(after, key))
    return Object.keys(fields).length === 0 && removed.length === 0
      ? null
      : { kind: 'object', fields, removed }
  }
  return { kind: 'value', value: next }
}

export function applyStatePatch<T>(previous: T, patch: StatePatch | null): T {
  if (!patch) return previous
  if (patch.kind === 'value') return patch.value as T
  if (patch.kind === 'array') {
    if (!Array.isArray(previous) || !Number.isSafeInteger(patch.length) || patch.length < 0) {
      throw new Error('状态数组变更无效')
    }
    const next = previous.slice(0, patch.length)
    next.length = patch.length
    for (const [key, value] of Object.entries(patch.items)) {
      const index = Number(key)
      if (!Number.isSafeInteger(index) || index < 0 || index >= patch.length) {
        throw new Error('状态数组下标无效')
      }
      next[index] = applyStatePatch(previous[index], value)
    }
    return next as T
  }
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) {
    throw new Error('状态对象变更无效')
  }
  const before = previous as Record<string, unknown>
  const next = {
    ...before,
    ...Object.fromEntries(
      Object.entries(patch.fields).map(([key, value]) => [
        key,
        applyStatePatch(Object.hasOwn(before, key) ? before[key] : undefined, value)
      ])
    )
  }
  for (const key of patch.removed) delete next[key]
  return next as T
}

export function reuseUnchangedState<T>(previous: T, next: T): T {
  return applyStatePatch(previous, createStatePatch(previous, next))
}

export function createAppStateUpdate(previous: AppState, next: AppState): AppStateUpdate {
  const { revision: _previousRevision, ...before } = previous
  const { revision: _nextRevision, ...after } = next
  return {
    baseRevision: previous.revision ?? 0,
    revision: next.revision ?? 0,
    patch: createStatePatch(before, after)
  }
}

export function applyAppStateUpdate(previous: AppState, update: AppStateUpdate): AppState {
  if (update.baseRevision !== (previous.revision ?? 0)) {
    throw new Error('数据已在后台更新，请重试刚才的操作')
  }
  if (
    update.patch &&
    (update.patch.kind !== 'object' ||
      Object.hasOwn(update.patch.fields, 'revision') ||
      update.patch.removed.includes('revision'))
  ) {
    throw new Error('状态变更请求无效')
  }
  return { ...applyStatePatch(previous, update.patch), revision: update.revision }
}
