import { useEffect } from 'react'
import { dataCenter } from '../api'
import { useDetailResource } from './detail-hooks'
import { EMPTY_DAILY_SCAN_STATE } from './daily-scan'

export function useDailyMarketScan(enabled: boolean) {
  const scan = dataCenter.dailyScan
  useEffect(() => (enabled ? scan.retain() : undefined), [scan, enabled])
  const result = useDetailResource(scan.result, enabled)
  const state = useDetailResource(scan.state, enabled)
  return {
    result: result.data ?? null,
    scanState: state.data ?? EMPTY_DAILY_SCAN_STATE,
    loading: result.loading || state.loading,
    error: result.error || state.error,
    run: scan.run
  }
}
