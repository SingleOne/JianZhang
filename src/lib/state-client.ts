import {
  applyAppStateUpdate,
  createAppStateUpdate,
  type AppStateUpdate,
  type StockDesktopBridge
} from '../shared/state-changes'
import type { AppState, BootstrapResult, StockDesktopApi } from '../shared/types'

/** Keep the full local view while sending only changes across Electron IPC. */
export function createStateClient(bridge: StockDesktopBridge): StockDesktopApi {
  let current: AppState | undefined
  let bootstrapPromise: Promise<BootstrapResult> | null = null
  const pending: AppStateUpdate[] = []
  const listeners = new Set<(state: AppState) => void>()
  const errorListeners = new Set<(message: string) => void>()

  const publish = (): void => {
    if (current) listeners.forEach((listener) => listener(current!))
  }

  const getBootstrap = (): Promise<BootstrapResult> => {
    if (bootstrapPromise) return bootstrapPromise
    bootstrapPromise = bridge
      .getBootstrap(current?.revision)
      .then((result) => {
        if (result.state && (!current || (result.state.revision ?? 0) >= (current.revision ?? 0))) {
          current = result.state
        }
        if (!current) throw new Error('未能读取初始应用状态')
        for (const update of pending.splice(0)) {
          if (update.revision <= (current.revision ?? 0)) continue
          if (update.baseRevision !== (current.revision ?? 0)) {
            pending.push(update)
            continue
          }
          current = applyAppStateUpdate(current, update)
        }
        publish()
        return { ...result, state: current }
      })
      .finally(() => {
        bootstrapPromise = null
      })
    return bootstrapPromise
  }

  const receive = async (update: AppStateUpdate): Promise<AppState> => {
    if (!current) {
      pending.push(update)
      return (await getBootstrap()).state
    }
    if (update.revision <= (current.revision ?? 0)) return current
    if (update.baseRevision !== (current.revision ?? 0)) {
      pending.push(update)
      return (await getBootstrap()).state
    }
    current = applyAppStateUpdate(current, update)
    publish()
    return current
  }

  bridge.onStateChanged((update) => {
    void receive(update).catch((reason: unknown) => {
      const message = reason instanceof Error ? reason.message : '同步应用状态失败'
      errorListeners.forEach((listener) => listener(message))
    })
  })

  const changesFor = (next: AppState): AppStateUpdate => {
    if (!current || next.revision !== current.revision) {
      throw new Error('数据已在后台更新，请重试刚才的操作')
    }
    return createAppStateUpdate(current, next)
  }

  return {
    ...bridge,
    getBootstrap,
    async saveState(next) {
      const update = changesFor(next)
      if (!update.patch) return current!
      return receive(await bridge.saveStateChanges(update))
    },
    async archiveStockTrackingCycle(next, profile, deletePreviousArchives) {
      const result = await bridge.archiveStockTrackingCycle(
        changesFor(next),
        profile,
        deletePreviousArchives
      )
      return { state: await receive(result.update), archiveIndex: result.archiveIndex }
    },
    exportConfig: () => bridge.exportConfig(),
    onStateUpdated(callback) {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
    onDataError(callback) {
      errorListeners.add(callback)
      const unsubscribe = bridge.onDataError(callback)
      return () => {
        errorListeners.delete(callback)
        unsubscribe()
      }
    }
  }
}
