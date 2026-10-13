import App from '../App'
import { ConfirmDialogProvider } from '../components/ConfirmDialog'
import { useLayoutEffect } from 'react'
import { renderWindow } from './render-window'
import '../styles.css'
import '../components/ConfirmDialog.css'
import '../styles/app-feedback.css'

function StartupShellDismiss() {
  useLayoutEffect(() => {
    document.getElementById('startup-shell')?.remove()
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
