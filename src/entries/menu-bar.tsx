import { TrayHoverSummary } from '../components/TrayHoverSummary'
import { renderWindow } from './render-window'
import '../styles/window-surface.css'
import '../components/TaskbarTicker.css'
import '../components/AlertBadges.css'
import '../components/MenuBar.css'

export function renderMenuBar(): void {
  renderWindow(<TrayHoverSummary interactive />)
}
