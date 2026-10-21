import App from '../App'
import { ConfirmDialogProvider } from '../components/ConfirmDialog'
import { renderWindow } from './render-window'
import '../styles.css'
import '../components/WatchlistTable.css'
import '../components/ConfirmDialog.css'
import '../styles/app-feedback.css'
import '../styles/main-market.css'

export function renderMainWindow(): void {
  renderWindow(
    <ConfirmDialogProvider>
      <App />
    </ConfirmDialogProvider>
  )
}
