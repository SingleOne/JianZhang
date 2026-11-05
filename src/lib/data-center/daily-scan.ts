import type { DailyMarketScanState, StockDesktopApi } from '../../shared/types'
import type { createDetailCenter } from './details'

export const EMPTY_DAILY_SCAN_STATE: DailyMarketScanState = {
  running: false,
  progress: { stage: 'idle', message: '尚未执行收盘扫描。', completed: 0, total: 0 },
  error: null
}

/** Window-owned reads and event lifetime; the main process owns the actual scan task. */
export function createDailyScanCenter(
  transport: StockDesktopApi,
  details: ReturnType<typeof createDetailCenter>
) {
  let cleared = false
  let resultCleared = false
  let generation = 0
  let activityVersion = 0
  let consumers = 0
  let unsubscribe: (() => void) | undefined
  let pending: ReturnType<StockDesktopApi['runDailyMarketScan']> | undefined
  const resultResource = () =>
    details.resource(
      'daily-scan:result',
      () => (resultCleared ? Promise.resolve(null) : transport.getDailyMarketScanResult()),
      { quoteId: '', category: 'daily-scan-result', maxAge: Infinity }
    )
  const stateResource = () =>
    details.resource(
      'daily-scan:state',
      () =>
        cleared ? Promise.resolve(EMPTY_DAILY_SCAN_STATE) : transport.getDailyMarketScanState(),
      { quoteId: '', category: 'daily-scan-state', maxAge: Infinity }
    )
  const reloadResult = () => {
    resultResource().invalidate(true)
    void resultResource()
      .request()
      .catch(() => undefined)
  }
  const reloadState = () => {
    stateResource().invalidate(true)
    void stateResource()
      .request()
      .catch(() => undefined)
  }
  const receive = (next: DailyMarketScanState) => {
    if (cleared) return
    const previous = stateResource().getSnapshot().data
    if (next.running && !previous?.running) activityVersion += 1
    stateResource().update(next)
    // Includes startup's asynchronous disk load (idle -> completed).
    if ((next.running && !previous?.running) || !next.running) reloadResult()
  }
  const retain = () => {
    consumers += 1
    if (consumers === 1) {
      unsubscribe = transport.onDailyMarketScanProgress(receive)
      // The task may have finished while the dialog had no consumer.
      reloadResult()
      reloadState()
    }
    return () => {
      consumers -= 1
      if (!consumers) {
        unsubscribe?.()
        unsubscribe = undefined
      }
    }
  }
  const run = (): ReturnType<StockDesktopApi['runDailyMarketScan']> => {
    if (pending) return pending
    cleared = false
    const version = generation
    const activity = ++activityVersion
    resultResource().invalidate(true)
    stateResource().update({
      ...EMPTY_DAILY_SCAN_STATE,
      running: true,
      progress: { stage: 'quotes', message: '正在获取全市场 A 股行情…', completed: 0, total: 0 }
    })
    const task = Promise.resolve()
      .then(() => transport.runDailyMarketScan())
      .then((snapshot) => {
        if (version === generation) {
          resultCleared = false
          const previous = resultResource().getSnapshot().data
          if (
            activity === activityVersion &&
            (!previous || Date.parse(previous.generatedAt) <= Date.parse(snapshot.generatedAt))
          )
            resultResource().update(snapshot)
          reloadResult()
        }
        return snapshot
      })
      .finally(() => {
        if (pending === task) pending = undefined
        if (version === generation) reloadState()
      })
    pending = task
    return task
  }
  return {
    get result() {
      return resultResource()
    },
    get state() {
      return stateResource()
    },
    retain,
    run,
    clear() {
      generation += 1
      cleared = true
      resultCleared = true
      // Main-process getResult still holds its old snapshot until the scheduled restart.
      resultResource().invalidate()
      stateResource().invalidate()
    },
    dispose() {
      generation += 1
      cleared = true
      unsubscribe?.()
      unsubscribe = undefined
    }
  }
}
