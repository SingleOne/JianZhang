import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import './StartupOverlay.css'

interface StartupOverlayProps {
  initializing: boolean
  watchlistRendered: boolean
  onExited: () => void
}

export function StartupOverlay({ initializing, watchlistRendered, onExited }: StartupOverlayProps) {
  const [opening, setOpening] = useState(false)

  useLayoutEffect(() => {
    // The React overlay is committed before removing the pre-React startup shell.
    document.getElementById('startup-shell')?.remove()
  }, [])

  useEffect(() => {
    if (!watchlistRendered) return
    let frame = 0

    const openWhenStylesReady = () => {
      const rootStyles = getComputedStyle(document.documentElement)
      const appStylesReady = rootStyles.getPropertyValue('--app-styles-ready').trim() === '1'
      const watchlistStylesReady =
        rootStyles.getPropertyValue('--watchlist-styles-ready').trim() === '1'

      if (!appStylesReady || !watchlistStylesReady) {
        frame = window.requestAnimationFrame(openWhenStylesReady)
        return
      }

      // Leave a painted frame of the completed table beneath the closed overlay.
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setOpening(true))
      })
    }

    openWhenStylesReady()
    return () => window.cancelAnimationFrame(frame)
  }, [watchlistRendered])

  return createPortal(
    <div
      className={`startup-overlay${opening ? ' is-opening' : ''}`}
      onAnimationEnd={(event) => {
        if (
          event.target === event.currentTarget &&
          event.animationName === 'startup-shutter-open'
        ) {
          onExited()
        }
      }}
    >
      <div className="startup-titlebar">
        <span className="startup-brand-mark" aria-hidden="true">
          ↗
        </span>
        <span className="startup-brand-name">见涨</span>
      </div>
      <div className="startup-content">
        <div className="startup-status" role="status" aria-live="polite">
          <span className="startup-spinner" aria-hidden="true" />
          <span>{initializing ? '正在读取自选行情…' : '正在准备自选行情…'}</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
