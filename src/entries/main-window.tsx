import App from '../App'
import { ConfirmDialogProvider } from '../components/ConfirmDialog'
import { renderWindow } from './render-window'
import '../styles.css'
import '../components/SettingsMenu.css'
import '../components/WatchlistTable.css'
import '../components/WatchlistDialogs.css'
import '../components/ConfirmDialog.css'
import '../components/TTradingDrawer.css'
import '../components/AlertBadges.css'
import '../components/TTradingDrawerLayout.css'
import '../components/PositionDialogResponsive.css'
import '../components/ExpandedStockDetails.css'
import '../components/ShareholderPanel.css'
import '../components/PortfolioQualityDialog.css'
import '../styles/app-feedback.css'
import '../modules/ai/renderer/AiAssistantDrawer.css'
import '../styles/dark-theme.css'

export function renderMainWindow(): void {
  renderWindow(
    <ConfirmDialogProvider>
      <App />
    </ConfirmDialogProvider>
  )
}
