import { TaskbarTicker } from '../components/TaskbarTicker'
import { renderWindow } from './render-window'
import '../styles/window-surface.css'
import '../components/AlertBadges.css'
import '../components/TaskbarTicker.css'

export function renderTaskbarTicker(): void {
  renderWindow(<TaskbarTicker />)
}
