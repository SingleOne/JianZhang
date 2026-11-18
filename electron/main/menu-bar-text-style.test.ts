import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { load, createRequire } = vi.hoisted(() => ({ load: vi.fn(), createRequire: vi.fn() }))
vi.mock('node:module', () => ({ createRequire }))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!

beforeEach(() => {
  vi.resetModules()
  load.mockReset()
  createRequire.mockReturnValue(load)
  Object.defineProperty(process, 'platform', { value: 'darwin' })
})

afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  vi.restoreAllMocks()
})

describe('native menu bar text styling', () => {
  it('loads the emitted addon beside the main bundle only once', async () => {
    const { installMenuBarTextStyle } = await import('./menu-bar-text-style')
    installMenuBarTextStyle()
    installMenuBarTextStyle()
    expect(load).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledWith(expect.stringMatching(/[/\\]menu-bar-text\.node$/))
  })

  it('does not load AppKit styling on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const { installMenuBarTextStyle } = await import('./menu-bar-text-style')
    installMenuBarTextStyle()
    expect(createRequire).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
  })

  it('keeps the app usable and reports once if the optional native module cannot load', async () => {
    const error = new Error('missing addon')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    load.mockImplementation(() => {
      throw error
    })
    const { installMenuBarTextStyle } = await import('./menu-bar-text-style')
    expect(() => installMenuBarTextStyle()).not.toThrow()
    installMenuBarTextStyle()
    expect(log).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith('菜单栏文字描边加载失败', error)
    expect(load).toHaveBeenCalledOnce()
  })
})
