import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { TaskbarTicker } from './components/TaskbarTicker'
import { TrayHoverSummary } from './components/TrayHoverSummary'
import { ConfirmDialogProvider } from './components/ConfirmDialog'
import './styles.css'
import './components/SettingsMenu.css'
import './components/WatchlistTable.css'
import './components/WatchlistDialogs.css'
import './components/ConfirmDialog.css'
import './components/TTradingDrawer.css'
import './components/PositionDialogResponsive.css'
import './components/ExpandedStockDetails.css'
import './styles/app-feedback.css'
import './components/TaskbarTicker.css'
import './modules/ai/renderer/AiAssistantDrawer.css'

const windowMode = new URLSearchParams(window.location.search).get('mode')
const taskbarMode = windowMode === 'taskbar'
const trayMode = windowMode === 'tray'
document.documentElement.classList.toggle('taskbar-mode', taskbarMode)
document.documentElement.classList.toggle('tray-mode', trayMode)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmDialogProvider>
      {taskbarMode ? <TaskbarTicker /> : trayMode ? <TrayHoverSummary /> : <App />}
    </ConfirmDialogProvider>
  </StrictMode>
)
