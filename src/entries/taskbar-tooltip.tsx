import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TaskbarStockTooltip } from '../components/TaskbarStockTooltip'
import '../styles/window-surface.css'
import '../components/TaskbarTicker.css'
import '../styles/macos-popovers.css'

export function renderTaskbarTooltip(): void {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <TaskbarStockTooltip />
    </StrictMode>
  )
}
