import type { Rectangle } from 'electron'
import type { TaskbarTooltipAnchor } from '../../src/shared/types'

export function getMenuBarTooltipBounds(
  panel: Rectangle,
  anchor: TaskbarTooltipAnchor,
  workArea: Rectangle,
  preferredSize: { width: number; height: number }
): Rectangle {
  const margin = 8
  const width = Math.min(preferredSize.width, workArea.width - margin * 2)
  const height = Math.min(preferredSize.height, workArea.height - margin * 2)
  const minX = workArea.x + margin
  const maxX = workArea.x + workArea.width - width - margin
  const minY = workArea.y + margin
  const maxY = workArea.y + workArea.height - height - margin
  const left = panel.x - width - margin
  const right = panel.x + panel.width + margin
  let x: number
  let y = panel.y + (anchor.top ?? 0)

  if (left >= minX) x = left
  else if (right <= maxX) x = right
  else {
    // On narrow displays, keep the card clear of the hovered row whenever possible.
    x = panel.x + anchor.left + anchor.width / 2 - width / 2
    const rowTop = panel.y + (anchor.top ?? 0)
    const rowBottom = rowTop + (anchor.height ?? 0)
    y = rowBottom + margin <= maxY ? rowBottom + margin : rowTop - height - margin
  }

  return {
    x: Math.round(Math.max(minX, Math.min(x, maxX))),
    y: Math.round(Math.max(minY, Math.min(y, maxY))),
    width,
    height
  }
}
