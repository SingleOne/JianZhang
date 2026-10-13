import App from '../App'
import { ConfirmDialogProvider } from '../components/ConfirmDialog'
import { useLayoutEffect } from 'react'
import { renderWindow } from './render-window'
import '../styles.css'
import '../components/WatchlistTable.css'
import '../components/ConfirmDialog.css'
import '../styles/app-feedback.css'

function StartupShellDismiss() {
  useLayoutEffect(() => {
    let frame = 0

    const dismissWhenStylesReady = () => {
      const rootStyles = getComputedStyle(document.documentElement)
      const appStylesReady = rootStyles.getPropertyValue('--app-styles-ready').trim() === '1'
      const watchlistStylesReady =
        rootStyles.getPropertyValue('--watchlist-styles-ready').trim() === '1'

      if (!appStylesReady || !watchlistStylesReady) {
        frame = window.requestAnimationFrame(dismissWhenStylesReady)
        return
      }

      frame = window.requestAnimationFrame(() => {
        document.getElementById('startup-shell')?.remove()
      })
    }

    dismissWhenStylesReady()
    return () => window.cancelAnimationFrame(frame)
  }, [])

  return null
}

export function renderMainWindow(): void {
  renderWindow(
    <>
      <StartupShellDismiss />
      <ConfirmDialogProvider>
        <App />
      </ConfirmDialogProvider>
    </>
  )
}
