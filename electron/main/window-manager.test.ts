import { EventEmitter } from 'node:events'
import type { BrowserWindowConstructorOptions, Rectangle } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS, type AppState } from '../../src/shared/types'
import { WindowManager } from './window-manager'

const { windows, trays } = vi.hoisted(() => ({
  windows: [] as MockWindow[],
  trays: [] as EventEmitter[]
}))

class MockWindow extends EventEmitter {
  readonly webContents = Object.assign(new EventEmitter(), { send: vi.fn() })
  private visible = false
  private destroyed = false
  private bounds: Rectangle
  readonly setAlwaysOnTop = vi.fn()
  readonly setVisibleOnAllWorkspaces = vi.fn()
  readonly setIgnoreMouseEvents = vi.fn()
  readonly setMenuBarVisibility = vi.fn()
  readonly moveTop = vi.fn()
  readonly focus = vi.fn()
  readonly loadURL = vi.fn()
  readonly loadFile = vi.fn()
  readonly showInactive = vi.fn(() => {
    this.visible = true
  })

  constructor(readonly options: BrowserWindowConstructorOptions) {
    super()
    this.bounds = {
      x: options.x ?? 0,
      y: options.y ?? 0,
      width: options.width ?? 550,
      height: options.height ?? 260
    }
    windows.push(this)
  }

  getBounds() {
    return this.bounds
  }

  setBounds(bounds: Rectangle) {
    this.bounds = bounds
  }

  isDestroyed() {
    return this.destroyed
  }

  isVisible() {
    return this.visible
  }

  show() {
    this.visible = true
  }

  hide() {
    this.visible = false
  }

  destroy() {
    this.visible = false
    this.destroyed = true
    this.emit('closed')
  }
}

vi.mock('electron', () => {
  const display = {
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    workArea: { x: 0, y: 25, width: 1440, height: 827 }
  }
  return {
    BrowserWindow: vi.fn(function (options: BrowserWindowConstructorOptions) {
      return new MockWindow(options)
    }),
    Tray: class extends EventEmitter {
      constructor() {
        super()
        trays.push(this)
      }
      setIgnoreDoubleClickEvents() {}
      setTitle() {}
      setToolTip() {}
      setContextMenu() {}
      popUpContextMenu() {}
      getBounds() {
        return { x: 1200, y: 0, width: 100, height: 25 }
      }
      destroy() {}
    },
    Menu: { buildFromTemplate: () => ({ insert: vi.fn() }) },
    MenuItem: class {},
    nativeTheme: Object.assign(new EventEmitter(), { themeSource: 'system' }),
    screen: Object.assign(new EventEmitter(), {
      getPrimaryDisplay: () => ({
        ...display,
        workArea: { ...display.workArea, y: 0, height: 852 }
      }),
      getDisplayNearestPoint: () => display,
      getDisplayMatching: () => display,
      getCursorScreenPoint: () => ({ x: 1200, y: 0 })
    })
  }
})

vi.mock('node:fs', () => ({
  existsSync: () => true,
  readFileSync: () => JSON.stringify({ visible: false, taskbarMode: true })
}))
vi.mock('./tray-icons', () => ({ createAppIcon: vi.fn(), createMenuBarIcon: vi.fn() }))

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
let manager: WindowManager

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  vi.useFakeTimers()
  windows.length = 0
  trays.length = 0
  manager = new WindowManager(
    {
      getState: () =>
        ({
          settings: DEFAULT_APP_SETTINGS,
          watchlist: [{ quoteId: '1.600000', name: '浦发银行', showInTaskbar: true }],
          stockTradingBooks: {}
        }) as AppState,
      getQuotes: () => [],
      setMenuBarQuoteId: vi.fn(),
      isQuitting: () => false,
      refreshQuotes: vi.fn(),
      setAutoRefreshQuotes: vi.fn(),
      quit: vi.fn()
    },
    '/unused-test-state'
  )
})

afterEach(() => {
  manager.dispose()
  Object.defineProperty(process, 'platform', platformDescriptor)
  vi.useRealTimers()
})

function openPanel() {
  manager.create()
  trays[0].emit('click')
  const panel = windows[0]
  panel.webContents.emit('did-finish-load')
  return panel
}

const anchor = { quoteId: '1.600000', left: 0, top: 40, width: 560, height: 52 }

describe('menu bar stock details', () => {
  it('reuses the taskbar detail renderer in a non-focusing child of the macOS panel', () => {
    const panel = openPanel()
    manager.setTaskbarTooltip(anchor)
    const tooltip = windows[1]
    tooltip.webContents.emit('did-finish-load')

    expect(tooltip.options.parent).toBe(panel)
    expect(tooltip.options.focusable).toBe(false)
    expect(tooltip.loadFile).toHaveBeenCalledWith(expect.any(String), {
      query: { mode: 'taskbar-tooltip' }
    })
    expect(tooltip.setIgnoreMouseEvents).toHaveBeenCalledWith(true)
    expect(tooltip.showInactive).toHaveBeenCalledOnce()
    expect(tooltip.focus).not.toHaveBeenCalled()
    expect(panel.isVisible()).toBe(true)
    expect(tooltip.getBounds().x + tooltip.getBounds().width).toBeLessThan(panel.getBounds().x)

    manager.setTaskbarTooltip({ ...anchor, quoteId: '0.300750', top: 92 })
    expect(windows).toHaveLength(2)
    expect(tooltip.webContents.send).toHaveBeenLastCalledWith('taskbar:tooltip-stock', '0.300750')
  })

  it('does not reopen a late-loading tooltip after the panel closes', () => {
    const panel = openPanel()
    manager.setTaskbarTooltip(anchor)
    const tooltip = windows[1]
    panel.emit('blur')
    tooltip.webContents.emit('did-finish-load')
    manager.setTaskbarTooltip(anchor)

    expect(panel.isVisible()).toBe(false)
    expect(tooltip.isVisible()).toBe(false)
    expect(manager.getTaskbarTooltipQuoteId()).toBeNull()
    expect(tooltip.showInactive).not.toHaveBeenCalled()
  })

  it.each(['leave', 'close', 'escape', 'resize', 'destroy'])(
    'clears stock details on %s so no card survives the panel interaction',
    (action) => {
      const panel = openPanel()
      manager.setTaskbarTooltip(anchor)
      const tooltip = windows[1]
      tooltip.webContents.emit('did-finish-load')

      if (action === 'leave') manager.setTaskbarTooltip(null)
      if (action === 'close') manager.closeMenuBarPanel()
      if (action === 'escape') {
        panel.webContents.emit('before-input-event', { preventDefault: vi.fn() }, { key: 'Escape' })
      }
      if (action === 'resize') manager.resizeMenuBarPanel(400)
      if (action === 'destroy') panel.destroy()

      expect(tooltip.isVisible()).toBe(false)
      expect(manager.getTaskbarTooltipQuoteId()).toBeNull()
    }
  )

  it('preserves the Windows taskbar tooltip without macOS row coordinates', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    manager.create()
    manager.resizeTaskbarTicker(200, 36)
    manager.setTaskbarTooltip({ quoteId: anchor.quoteId, left: 0, width: 100 })
    const [taskbar, tooltip] = windows
    tooltip.webContents.emit('did-finish-load')

    expect(tooltip.options.parent).toBe(taskbar)
    expect(tooltip.options.type).toBeUndefined()
    expect(tooltip.getBounds().y + tooltip.getBounds().height).toBeLessThan(taskbar.getBounds().y)
    expect(tooltip.isVisible()).toBe(true)
    expect(tooltip.setVisibleOnAllWorkspaces).not.toHaveBeenCalled()
  })

  it('hides details after content grows even when the panel is already at its height limit', () => {
    const panel = openPanel()
    manager.resizeMenuBarPanel(900)
    const previousBounds = panel.getBounds()
    manager.setTaskbarTooltip(anchor)
    const tooltip = windows[1]
    tooltip.webContents.emit('did-finish-load')

    manager.resizeMenuBarPanel(950)

    expect(panel.getBounds()).toEqual(previousBounds)
    expect(tooltip.isVisible()).toBe(false)
    expect(manager.getTaskbarTooltipQuoteId()).toBeNull()
  })
})
