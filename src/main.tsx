import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { TaskbarTicker } from './components/TaskbarTicker'
import { TrayHoverSummary } from './components/TrayHoverSummary'
import './styles.css'

const windowMode = new URLSearchParams(window.location.search).get('mode')
const taskbarMode = windowMode === 'taskbar'
const trayMode = windowMode === 'tray'
document.documentElement.classList.toggle('taskbar-mode', taskbarMode)
document.documentElement.classList.toggle('tray-mode', trayMode)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {taskbarMode ? <TaskbarTicker /> : trayMode ? <TrayHoverSummary /> : <App />}
  </StrictMode>
)
