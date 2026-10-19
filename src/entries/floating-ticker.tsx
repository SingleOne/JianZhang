import { FloatingTicker } from '../components/FloatingTicker'
import { renderWindow } from './render-window'
import '../styles/window-surface.css'
import '../components/AlertBadges.css'
import '../components/FloatingTicker.css'

export function renderFloatingTicker(): void {
  renderWindow(<FloatingTicker />)
}
