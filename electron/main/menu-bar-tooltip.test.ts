import { describe, expect, it } from 'vitest'
import { getMenuBarTooltipBounds } from './menu-bar-tooltip'

const size = { width: 550, height: 260 }
const workArea = { x: 0, y: 25, width: 1440, height: 875 }
const panel = { x: 872, y: 33, width: 560, height: 400 }
const anchor = { quoteId: '1.600000', left: 0, top: 80, width: 560, height: 52 }

describe('menu bar tooltip placement', () => {
  it('keeps the card beside the hovered row without covering the panel', () => {
    const bounds = getMenuBarTooltipBounds(panel, anchor, workArea, size)
    expect(bounds.y).toBe(panel.y + anchor.top)
    expect(bounds.x + bounds.width).toBeLessThan(panel.x)
    expect(bounds.width).toBe(size.width)
  })

  it('uses the right side when the panel is near the left screen edge', () => {
    const leftPanel = { ...panel, x: 8 }
    const bounds = getMenuBarTooltipBounds(leftPanel, anchor, workArea, size)
    expect(bounds.x).toBeGreaterThan(leftPanel.x + leftPanel.width)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(workArea.width - 8)
  })

  it('keeps a bottom row card inside a display with a negative origin', () => {
    const display = { x: -1440, y: -875, width: 1440, height: 875 }
    const bounds = getMenuBarTooltipBounds(
      { ...panel, x: -568, y: -450 },
      { ...anchor, top: 350 },
      display,
      size
    )
    expect(bounds.x).toBeGreaterThanOrEqual(display.x + 8)
    expect(bounds.y).toBeGreaterThanOrEqual(display.y + 8)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(-8)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(-8)
  })

  it('falls below the row on narrow displays without covering the hovered row', () => {
    const bounds = getMenuBarTooltipBounds(
      { ...panel, x: 8 },
      anchor,
      { ...workArea, width: 800 },
      size
    )
    expect(bounds.y).toBeGreaterThan(panel.y + anchor.top + anchor.height)
    expect(bounds.x).toBeGreaterThanOrEqual(8)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(792)
  })

  it('falls above a bottom row when neither side has room', () => {
    const bottomPanel = { ...panel, x: 8, y: 400 }
    const bottomAnchor = { ...anchor, top: 320 }
    const bounds = getMenuBarTooltipBounds(
      bottomPanel,
      bottomAnchor,
      { ...workArea, width: 800 },
      size
    )
    expect(bounds.y + bounds.height).toBeLessThan(bottomPanel.y + bottomAnchor.top)
  })

  it('limits the card dimensions to a small screen work area', () => {
    const bounds = getMenuBarTooltipBounds(
      { x: 108, y: 58, width: 304, height: 120 },
      anchor,
      { x: 100, y: 50, width: 320, height: 240 },
      size
    )
    expect(bounds).toEqual({ x: 108, y: 58, width: 304, height: 224 })
  })
})
