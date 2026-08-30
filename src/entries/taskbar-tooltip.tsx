import { TaskbarStockTooltip } from '../components/TaskbarStockTooltip'
import { renderWindow } from './render-window'
import '../styles/window-surface.css'
import '../components/TaskbarTicker.css'

export function renderTaskbarTooltip(): void {
  renderWindow(<TaskbarStockTooltip />)
}
