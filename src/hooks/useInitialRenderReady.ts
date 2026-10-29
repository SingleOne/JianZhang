import { useEffect } from 'react'
import { stockApi } from '../lib/api'
import { ensureAppThemeStyles, getResolvedAppTheme } from '../lib/theme'

export function useInitialRenderReady(ready: boolean): void {
  useEffect(() => {
    if (!ready) return
    let active = true
    let frame = 0
    void ensureAppThemeStyles(getResolvedAppTheme()).then(() => {
      if (!active) return
      // Report only after the committed content has had a frame to paint.
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => stockApi.notifyInitialRender())
      })
    })
    return () => {
      active = false
      window.cancelAnimationFrame(frame)
    }
  }, [ready])
}
