import { TrayHoverSummary } from '../components/TrayHoverSummary'
import { renderWindow } from './render-window'
import '../styles/window-surface.css'
import '../components/TaskbarTicker.css'

export function renderTrayHoverSummary(): void {
  renderWindow(<TrayHoverSummary />)
}
