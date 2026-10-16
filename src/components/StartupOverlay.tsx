import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './StartupOverlay.css'

interface StartupOverlayProps {
  initializing: boolean
  watchlistRendered: boolean
  onExited: () => void
}

const STARTUP_TREND_PATH = 'M64 174 105 139 135 158 192 91'

function StartupTrendAnimation() {
  return (
    <svg className="startup-trend" viewBox="0 0 256 256" aria-hidden="true" focusable="false">
      <path className="startup-trend-track" d={STARTUP_TREND_PATH} />
      <path className="startup-trend-line" d={STARTUP_TREND_PATH} pathLength={100} />
      <path className="startup-trend-tip" d={STARTUP_TREND_PATH} pathLength={100} />
      <path className="startup-trend-arrow" d="M158 94 192 91 189 125" />
    </svg>
  )
}

export function StartupOverlay({ initializing, watchlistRendered, onExited }: StartupOverlayProps) {
  const [opening, setOpening] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const startupShell = document.getElementById('startup-shell')
    const animationTime = startupShell
      ?.querySelector('.startup-trend-line')
      ?.getAnimations()[0]?.currentTime
    if (typeof animationTime === 'number') {
      overlayRef.current?.style.setProperty('--startup-trend-delay', `${-animationTime}ms`)
    }
    // The React overlay is committed before removing the pre-React startup shell.
    startupShell?.remove()
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
      ref={overlayRef}
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
        <StartupTrendAnimation />
        <div className="startup-status" role="status" aria-live="polite">
          <span>{initializing ? '正在读取自选行情…' : '正在准备自选行情…'}</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
