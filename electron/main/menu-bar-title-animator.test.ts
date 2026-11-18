import type { NativeImage, Tray } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuBarPresentation } from '../../src/lib/menu-bar'
import { MenuBarTitleAnimator } from './menu-bar-title-animator'

const { render, dispose, preferences, icon } = vi.hoisted(() => ({
  render: vi.fn(),
  dispose: vi.fn(),
  preferences: { reducedMotion: false },
  icon: { toDataURL: () => 'data:image/png;base64,icon' }
}))

vi.mock('electron', () => ({
  systemPreferences: {
    getAnimationSettings: () => ({ prefersReducedMotion: preferences.reducedMotion })
  }
}))
vi.mock('./tray-icons', () => ({ createMenuBarIcon: () => icon }))
vi.mock('./menu-bar-title-renderer', () => ({
  MenuBarTitleRenderer: class {
    render = render
    dispose = dispose
  }
}))

const first = { getSize: () => ({ width: 240, height: 22 }) } as NativeImage
const last = { getSize: () => ({ width: 240, height: 22 }) } as NativeImage
const tray = { setTitle: vi.fn(), setImage: vi.fn() }
const onResize = vi.fn()
let animator: MenuBarTitleAnimator

function stock(quoteId = '1.600519', values?: string): MenuBarPresentation {
  const stockTitles = [
    {
      quoteId: '1.600519',
      label: '贵州茅台',
      values: '\u001b[31m1247.52\u001b[0m \u001b[31m+3.96%\u001b[0m'
    },
    {
      quoteId: '0.300750',
      label: '宁德时代',
      values: '\u001b[32m367.81\u001b[0m \u001b[32m-8.05%\u001b[0m'
    }
  ]
  const selected = stockTitles.find((title) => title.quoteId === quoteId)!
  if (values !== undefined) selected.values = values
  const title = `${selected.label} ${selected.values}`
  return { quoteId, title, stockTitles, tooltip: title }
}

beforeEach(() => {
  vi.useFakeTimers()
  preferences.reducedMotion = false
  render
    .mockReset()
    .mockImplementation(async ({ previousTitle }) =>
      previousTitle === null ? [last] : [first, last]
    )
  animator = new MenuBarTitleAnimator(tray as unknown as Tray, onResize)
})

afterEach(() => {
  animator.dispose()
  vi.useRealTimers()
})

async function update(presentation = stock(), rotating = true) {
  animator.update(presentation, rotating)
  await Promise.resolve()
  await Promise.resolve()
}

describe('macOS menu bar stock transitions', () => {
  it('animates stock changes and reserves the existing width, but directly updates prices', async () => {
    await update()
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ previousTitle: null }))

    const next = stock('0.300750')
    await update(next)
    expect(render).toHaveBeenLastCalledWith(
      expect.objectContaining({
        previousTitle: '贵州茅台',
        title: '宁德时代',
        minimumWidth: 240
      })
    )
    expect(tray.setImage).toHaveBeenLastCalledWith(first)
    await vi.advanceTimersByTimeAsync(288)
    expect(tray.setImage).toHaveBeenLastCalledWith(last)
    expect(vi.getTimerCount()).toBe(0)

    await update(stock('0.300750', '368.00 -8.00%'))
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ previousTitle: null }))
    expect(tray.setTitle).toHaveBeenLastCalledWith('368.00 -8.00% ', { fontType: 'monospaced' })
  })

  it('keeps neutral names in template frames and colored values in native text', async () => {
    await update()
    expect(render).toHaveBeenLastCalledWith({
      title: '贵州茅台',
      previousTitle: null,
      titles: ['贵州茅台', '宁德时代'],
      minimumWidth: 0,
      icon: 'data:image/png;base64,icon'
    })
    expect(tray.setTitle).toHaveBeenLastCalledWith(stock().stockTitles[0].values, {
      fontType: 'monospaced'
    })

    await update(stock('0.300750'))
    expect(tray.setTitle).toHaveBeenLastCalledWith(stock().stockTitles[1].values + ' ', {
      fontType: 'monospaced'
    })
  })

  it('reserves native value width after a longer quote and resets it with the selection', async () => {
    await update(stock('1.600519', '123456.78 +123.45%'))
    await update()
    expect(tray.setTitle).toHaveBeenLastCalledWith(stock().stockTitles[0].values + '    ', {
      fontType: 'monospaced'
    })
    animator.update(stock(), true, true)
    await Promise.resolve()
    expect(tray.setTitle).toHaveBeenLastCalledWith(stock().stockTitles[0].values, {
      fontType: 'monospaced'
    })
  })

  it('coalesces incoming prices instead of cutting off the active stock animation', async () => {
    await update()
    const next = stock('0.300750')
    await update(next)
    const calls = render.mock.calls.length
    await update(stock('0.300750', '368.00 -8.00%'))
    await update(stock('0.300750', '369.00 -7.80%'))
    expect(render).toHaveBeenCalledTimes(calls)

    await vi.advanceTimersByTimeAsync(288)
    expect(render).toHaveBeenCalledTimes(calls + 1)
    expect(render).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: '宁德时代',
        previousTitle: null
      })
    )
    expect(tray.setTitle).toHaveBeenLastCalledWith('369.00 -7.80% ', { fontType: 'monospaced' })
  })

  it('respects reduced motion while retaining fixed-width rendering', async () => {
    await update()
    preferences.reducedMotion = true
    await update(stock('0.300750'))
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ previousTitle: null }))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('recalculates width without a transition after the stock selection changes', async () => {
    await update()
    animator.update(stock('0.300750'), true, true)
    await Promise.resolve()
    expect(render).toHaveBeenLastCalledWith(
      expect.objectContaining({
        previousTitle: null,
        minimumWidth: 0
      })
    )
  })

  it('cancels animation when rotation is disabled and restores the native title', async () => {
    await update()
    await update(stock('0.300750'))
    await update(stock(), false)
    expect(tray.setTitle).toHaveBeenLastCalledWith(stock().title, { fontType: 'monospacedDigit' })
    expect(tray.setImage).toHaveBeenLastCalledWith(icon)
    expect(dispose).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    const calls = tray.setImage.mock.calls.length
    await vi.advanceTimersByTimeAsync(500)
    expect(tray.setImage).toHaveBeenCalledTimes(calls)
  })

  it.each(['disable', 'dispose'])('ignores late render results after %s', async (action) => {
    let finish!: (frames: NativeImage[]) => void
    render.mockReturnValueOnce(
      new Promise<NativeImage[]>((resolve) => {
        finish = resolve
      })
    )
    animator.update(stock(), true)
    if (action === 'disable') animator.update(stock(), false)
    else animator.dispose()
    const calls = tray.setImage.mock.calls.length
    finish([first, last])
    await Promise.resolve()
    await Promise.resolve()
    expect(tray.setImage).toHaveBeenCalledTimes(calls)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('falls back to the native title if rasterization fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    render.mockRejectedValueOnce(new Error('renderer unavailable'))
    await update()
    await Promise.resolve()
    expect(tray.setTitle).toHaveBeenLastCalledWith(stock().title, { fontType: 'monospacedDigit' })
    expect(tray.setImage).toHaveBeenLastCalledWith(icon)
    log.mockRestore()
  })
})
