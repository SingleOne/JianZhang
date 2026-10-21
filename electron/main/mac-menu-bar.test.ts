import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS, type AppState } from '../../src/shared/types'
import { MacMenuBar } from './mac-menu-bar'

const { updateTitle, disposeTitle, theme, destroyTray } = vi.hoisted(() => ({
  updateTitle: vi.fn(),
  disposeTitle: vi.fn(),
  theme: { events: null as EventEmitter | null },
  destroyTray: vi.fn()
}))

vi.mock('electron', () => {
  theme.events = new EventEmitter()
  return {
    BrowserWindow: vi.fn(),
    screen: {},
    nativeTheme: theme.events,
    Tray: class extends EventEmitter {
      setIgnoreDoubleClickEvents() {}
      setToolTip() {}
      destroy = destroyTray
    }
  }
})
vi.mock('./tray-icons', () => ({ createMenuBarIcon: vi.fn() }))
vi.mock('./menu-bar-title-animator', () => ({
  MenuBarTitleAnimator: class {
    update = updateTitle
    dispose = disposeTitle
  }
}))

let state: AppState
let menuBar: MacMenuBar

beforeEach(() => {
  vi.useFakeTimers()
  state = {
    settings: { ...DEFAULT_APP_SETTINGS, showTaskbarTicker: true, menuBarRotationSeconds: 0 },
    watchlist: [
      { quoteId: '1.600519', name: '贵州茅台', showInTaskbar: true },
      { quoteId: '0.300750', name: '宁德时代', showInTaskbar: true }
    ],
    stockTradingBooks: {}
  } as AppState
  menuBar = new MacMenuBar({
    getState: () => state,
    getQuotes: () => []
  })
})

afterEach(() => {
  menuBar.dispose()
  vi.useRealTimers()
})

describe('menu bar rotation lifecycle', () => {
  it('applies rotation settings immediately even when the title has not changed', () => {
    state.settings.menuBarRotationSeconds = 5
    menuBar.sync()
    expect(updateTitle).toHaveBeenLastCalledWith(expect.anything(), true, true)
    state.settings.menuBarRotationSeconds = 0
    menuBar.sync()
    expect(updateTitle).toHaveBeenLastCalledWith(expect.anything(), false, true)
  })

  it('rotates selected identities on the existing schedule without resetting layout', () => {
    state.settings.menuBarRotationSeconds = 5
    menuBar.sync()
    expect(updateTitle).toHaveBeenLastCalledWith(
      expect.objectContaining({ quoteId: '1.600519' }),
      true,
      true
    )
    vi.advanceTimersByTime(5_000)
    expect(updateTitle).toHaveBeenLastCalledWith(
      expect.objectContaining({ quoteId: '0.300750' }),
      true,
      false
    )
    vi.advanceTimersByTime(5_000)
    expect(updateTitle).toHaveBeenLastCalledWith(
      expect.objectContaining({ quoteId: '1.600519' }),
      true,
      false
    )
  })

  it('refreshes theme changes and removes timers and listeners when disposed', () => {
    updateTitle.mockClear()
    theme.events!.emit('updated')
    expect(updateTitle).toHaveBeenCalledOnce()
    menuBar.dispose()
    expect(theme.events!.listenerCount('updated')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(disposeTitle).toHaveBeenCalled()
    expect(destroyTray).toHaveBeenCalled()
  })
})
