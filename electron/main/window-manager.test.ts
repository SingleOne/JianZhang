import { EventEmitter } from 'node:events'
import { app, Menu, type BrowserWindowConstructorOptions, type Rectangle } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS, type AppState } from '../../src/shared/types'
import { atomicWriteJsonSync } from './file-storage'
import { WindowManager } from './window-manager'

const { windows, trays, windowState, cursor } = vi.hoisted(() => ({
  windows: [] as MockWindow[],
  trays: [] as EventEmitter[],
  windowState: { visible: false, taskbarMode: true },
  cursor: { x: 1200, y: 0 }
}))

class MockWindow extends EventEmitter {
  readonly webContents = Object.assign(new EventEmitter(), {
    send: vi.fn(),
    ipc: new EventEmitter(),
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
  readonly maximize = vi.fn()
  readonly isMinimized = vi.fn(() => false)
  readonly restore = vi.fn()
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
    app: { setActivationPolicy: vi.fn() },
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
    Menu: { buildFromTemplate: vi.fn(() => ({ insert: vi.fn() })) },
    MenuItem: class {},
    nativeTheme: Object.assign(new EventEmitter(), { themeSource: 'system' }),
    screen: Object.assign(new EventEmitter(), {
      getPrimaryDisplay: () => ({
        ...display,
        workArea: { ...display.workArea, y: 0, height: 852 }
      }),
      getDisplayNearestPoint: () => display,
      getDisplayMatching: () => display,
      getCursorScreenPoint: () => cursor
    })
  }
})

vi.mock('node:fs', () => ({
  existsSync: () => true,
  readFileSync: () => JSON.stringify(windowState)
}))
vi.mock('./file-storage', () => ({ atomicWriteJsonSync: vi.fn() }))
vi.mock('./tray-icons', () => ({ createAppIcon: vi.fn(), createMenuBarIcon: vi.fn() }))

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
let manager: WindowManager

function createManager() {
  return new WindowManager(
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
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  vi.useFakeTimers()
  windows.length = 0
  trays.length = 0
  windowState.visible = false
  windowState.taskbarMode = true
  cursor.x = 1200
  cursor.y = 0
  manager = createManager()
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

function toggleMenuBarMode() {
  const template = vi.mocked(Menu.buildFromTemplate).mock.lastCall![0]
  const toggle = template.find((item) => item.label?.startsWith('仅菜单栏模式'))!
    .click as () => void
  toggle()
}

const anchor = { quoteId: '1.600000', left: 0, top: 40, width: 560, height: 52 }

describe('macOS application visibility', () => {
  it.each([true, false])(
    'keeps the Dock entry in normal mode when the saved main window visibility is %s',
    (visible) => {
      windowState.visible = visible
      windowState.taskbarMode = false
      manager = createManager()
      manager.create()
      const main = windows[0]
      main.emit('ready-to-show')
      expect(app.setActivationPolicy).toHaveBeenLastCalledWith('regular')
      expect(main.isVisible()).toBe(visible)

      manager.showMainWindow()
      expect(main.isVisible()).toBe(true)
      expect(main.focus).toHaveBeenCalled()
      expect(app.setActivationPolicy).toHaveBeenLastCalledWith('regular')
      manager.hideMainWindow()
      expect(main.isVisible()).toBe(false)
      expect(app.setActivationPolicy).toHaveBeenLastCalledWith('regular')
    }
  )

  it('restores the app when leaving menu bar mode and keeps the same panel usable', () => {
    const panel = openPanel()
    expect(app.setActivationPolicy).toHaveBeenLastCalledWith('accessory')

    manager.showMainWindow()
    const main = windows[1]
    expect(app.setActivationPolicy).toHaveBeenLastCalledWith('regular')
    expect(atomicWriteJsonSync).toHaveBeenLastCalledWith('/unused-test-state/window-state.json', {
      visible: true,
      taskbarMode: false
    })
    main.emit('ready-to-show')
    expect(main.isVisible()).toBe(true)
    expect(panel.isVisible()).toBe(false)

    vi.mocked(app.setActivationPolicy).mockClear()
    vi.advanceTimersByTime(201)
    trays[0].emit('click')
    expect(panel.isVisible()).toBe(true)
    panel.emit('blur')
    expect(panel.isVisible()).toBe(false)
    expect(main.isVisible()).toBe(true)
    expect(windows).toHaveLength(2)
    expect(app.setActivationPolicy).not.toHaveBeenCalled()
  })

  it('hides the app only in menu bar mode and restores it on repeated mode switches', () => {
    const panel = openPanel()
    toggleMenuBarMode()
    const main = windows[1]
    main.emit('ready-to-show')
    expect(app.setActivationPolicy).toHaveBeenLastCalledWith('regular')

    toggleMenuBarMode()
    expect(main.isDestroyed()).toBe(true)
    expect(manager.isTaskbarMode()).toBe(true)
    expect(app.setActivationPolicy).toHaveBeenLastCalledWith('accessory')
    expect(atomicWriteJsonSync).toHaveBeenLastCalledWith('/unused-test-state/window-state.json', {
      visible: false,
      taskbarMode: true
    })

    vi.advanceTimersByTime(201)
    trays[0].emit('click')
    expect(panel.isVisible()).toBe(true)
    expect(app.setActivationPolicy).toHaveBeenLastCalledWith('accessory')
    toggleMenuBarMode()
    windows[2].emit('ready-to-show')
    expect(panel.isVisible()).toBe(false)
    expect(windows[2].isVisible()).toBe(true)
    expect(manager.isTaskbarMode()).toBe(false)
    expect(app.setActivationPolicy).toHaveBeenLastCalledWith('regular')
  })
})

describe('menu bar inline details', () => {
  it('keeps a single macOS panel and ignores obsolete secondary tooltip requests', () => {
    const panel = openPanel()
    manager.setTaskbarTooltip(anchor)
    manager.resizeTaskbarTooltip(177.25)
    expect(windows).toHaveLength(1)
    expect(panel.options.type).toBe('panel')
    expect(panel.setAlwaysOnTop).toHaveBeenCalledWith(true, 'pop-up-menu')
    // Fullscreen support must not implicitly switch the entire app out of the Dock.
    expect(panel.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    })
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
    expect(tooltip.setIgnoreMouseEvents).toHaveBeenCalledWith(false)
    // The transparent 24px shadow gutter may overlap the taskbar; the card must not.
    const cardBottom = tooltip.getBounds().y + tooltip.getBounds().height - 24
    expect(cardBottom).toBeLessThan(taskbar.getBounds().y)
    expect(tooltip.isVisible()).toBe(true)
    expect(tooltip.focus).not.toHaveBeenCalled()
    expect(tooltip.setVisibleOnAllWorkspaces).not.toHaveBeenCalled()
    expect(app.setActivationPolicy).not.toHaveBeenCalled()
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

  it('allows moving into the tooltip to click actions and hides after leaving the card', () => {
    const { tooltip } = openTooltip()
    const bounds = tooltip.getBounds()
    manager.scheduleTaskbarTooltipHide()
    cursor.x = bounds.x + bounds.width / 2
    cursor.y = bounds.y + bounds.height / 2
    vi.advanceTimersByTime(500)
    expect(tooltip.isVisible()).toBe(true)
    expect(manager.getTaskbarTooltipQuoteId()).toBe(anchor.quoteId)

    cursor.x = bounds.x - 1
    vi.advanceTimersByTime(250)
    expect(tooltip.isVisible()).toBe(false)
    expect(manager.getTaskbarTooltipQuoteId()).toBeNull()
  })

  it('cancels the pending hide when another taskbar stock is entered', () => {
    const { tooltip } = openTooltip()
    manager.scheduleTaskbarTooltipHide()
    manager.setTaskbarTooltip({ quoteId: '0.300750', left: 100, width: 100 })
    vi.advanceTimersByTime(250)
    expect(tooltip.isVisible()).toBe(true)
    expect(manager.getTaskbarTooltipQuoteId()).toBe('0.300750')
  })
})
