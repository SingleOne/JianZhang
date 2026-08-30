import { initializeAppTheme } from './lib/theme'

initializeAppTheme()

const windowMode = new URLSearchParams(window.location.search).get('mode')
const taskbarMode = windowMode === 'taskbar'
const taskbarTooltipMode = windowMode === 'taskbar-tooltip'
const trayMode = windowMode === 'tray'
document.documentElement.classList.toggle('taskbar-mode', taskbarMode)
document.documentElement.classList.toggle('taskbar-tooltip-mode', taskbarTooltipMode)
document.documentElement.classList.toggle('tray-mode', trayMode)

if (taskbarMode) {
  void import('./entries/taskbar-ticker').then(({ renderTaskbarTicker }) => renderTaskbarTicker())
} else if (taskbarTooltipMode) {
  void import('./entries/taskbar-tooltip').then(({ renderTaskbarTooltip }) =>
    renderTaskbarTooltip()
  )
} else if (trayMode) {
  void import('./entries/tray-hover-summary').then(({ renderTrayHoverSummary }) =>
    renderTrayHoverSummary()
  )
} else {
  void import('./entries/main-window').then(({ renderMainWindow }) => renderMainWindow())
}
