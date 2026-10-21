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
  readonly webContents = Object.assign(new EventEmitter(), {
    send: vi.fn(),
    getZoomFactor: vi.fn(() => 1)
  })
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
      setImage() {}
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

describe('menu bar inline details', () => {
  it('keeps a single macOS panel and ignores obsolete secondary tooltip requests', () => {
    const panel = openPanel()
    manager.setTaskbarTooltip(anchor)
    manager.resizeTaskbarTooltip(177.25)
    expect(windows).toHaveLength(1)
    expect(manager.getTaskbarTooltipQuoteId()).toBeNull()
    expect(panel.isVisible()).toBe(true)
  })

  it('shrinks the panel after inline details collapse without reserving a footer gap', () => {
    const panel = openPanel()
    manager.resizeMenuBarPanel(520.5)
    expect(panel.getBounds().height).toBe(521)
    manager.resizeMenuBarPanel(83.25)
    expect(panel.getBounds().height).toBe(84)
    expect(panel.isVisible()).toBe(true)
  })

  it.each([1.2 ** -0.5, 1.2 ** -1, 1.2])(
    'converts expanded and collapsed CSS heights at zoom %s',
    (zoomFactor) => {
      const panel = openPanel()
      panel.webContents.getZoomFactor.mockReturnValue(zoomFactor)
      manager.resizeMenuBarPanel(520.25)
      expect(panel.getBounds().height).toBe(Math.ceil(520.25 * zoomFactor))
      manager.resizeMenuBarPanel(280.25)
      expect(panel.getBounds().height).toBe(Math.ceil(280.25 * zoomFactor))
      expect(windows).toHaveLength(1)
    }
  )

  it.each(['close', 'escape', 'blur'])('closes the single panel on %s', (action) => {
    const panel = openPanel()
    if (action === 'close') manager.closeMenuBarPanel()
    if (action === 'blur') panel.emit('blur')
    if (action === 'escape') {
      panel.webContents.emit('before-input-event', { preventDefault: vi.fn() }, { key: 'Escape' })
    }
    expect(panel.isVisible()).toBe(false)
    manager.setTaskbarTooltip(anchor)
    expect(windows).toHaveLength(1)
  })

  it('caps long inline content at the panel height limit', () => {
    const panel = openPanel()
    manager.resizeMenuBarPanel(900)
    const bounds = panel.getBounds()
    manager.resizeMenuBarPanel(950)
    expect(panel.getBounds()).toEqual(bounds)
    expect(bounds.height).toBe(720)
    expect(panel.isVisible()).toBe(true)
  })
})

describe('Windows taskbar details', () => {
  function openTooltip() {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    manager.create()
    manager.resizeTaskbarTicker(200, 36)
    manager.setTaskbarTooltip({ quoteId: anchor.quoteId, left: 0, width: 100 })
    const [taskbar, tooltip] = windows
    tooltip.webContents.emit('did-finish-load')
    return { taskbar, tooltip }
  }

  it('preserves a non-focusing taskbar tooltip with transparent shadow padding', () => {
    const { taskbar, tooltip } = openTooltip()
    expect(tooltip.options.parent).toBe(taskbar)
    expect(tooltip.options.type).toBeUndefined()
    expect(tooltip.options.hasShadow).toBe(false)
    expect(tooltip.options.width).toBe(550 + 24 * 2)
    expect(tooltip.setIgnoreMouseEvents).toHaveBeenCalledWith(true)
    // The transparent 24px shadow gutter may overlap the taskbar; the card must not.
    const cardBottom = tooltip.getBounds().y + tooltip.getBounds().height - 24
    expect(cardBottom).toBeLessThan(taskbar.getBounds().y)
    expect(tooltip.isVisible()).toBe(true)
    expect(tooltip.focus).not.toHaveBeenCalled()
    expect(tooltip.setVisibleOnAllWorkspaces).not.toHaveBeenCalled()
  })

  it('keeps the detail minimum height and shadow gutter', () => {
    const { tooltip } = openTooltip()
    manager.resizeTaskbarTooltip(153.5)
    expect(tooltip.getBounds().height).toBe(200 + 24 * 2)
  })

  it('reuses the window across stocks and hides it when the hover ends', () => {
    const { tooltip } = openTooltip()
    manager.setTaskbarTooltip({ quoteId: '0.300750', left: 100, width: 100 })
    expect(windows).toHaveLength(2)
    expect(tooltip.webContents.send).toHaveBeenLastCalledWith('taskbar:tooltip-stock', '0.300750')
    manager.setTaskbarTooltip(null)
    expect(tooltip.isVisible()).toBe(false)
    expect(manager.getTaskbarTooltipQuoteId()).toBeNull()
  })
})
