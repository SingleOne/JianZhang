import { describe, expect, it, vi } from 'vitest'
import { MenuBarTitleRenderer } from './menu-bar-title-renderer'

const { createEmpty, executeJavaScript, destroy } = vi.hoisted(() => ({
  createEmpty: vi.fn(),
  executeJavaScript: vi.fn(),
  destroy: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: class {
    webContents = { executeJavaScript }
    loadURL = async () => {}
    isDestroyed = () => false
    destroy = destroy
  },
  nativeImage: { createEmpty }
}))

describe('menu bar name rendering', () => {
  it('marks every animation frame as a template with both scale representations', async () => {
    executeJavaScript.mockResolvedValue([
      ['data:image/png;base64,first-1x', 'data:image/png;base64,first-2x'],
      ['data:image/png;base64,last-1x', 'data:image/png;base64,last-2x']
    ])
    createEmpty.mockImplementation(() => ({
      addRepresentation: vi.fn(),
      setTemplateImage: vi.fn()
    }))
    const renderer = new MenuBarTitleRenderer()
    const frames = await renderer.render({
      title: '宁德时代',
      previousTitle: '贵州茅台',
      titles: ['贵州茅台', '宁德时代'],
      minimumWidth: 0,
      icon: 'data:image/png;base64,icon'
    })
    expect(frames).toHaveLength(2)
    for (const [index, frame] of frames.entries()) {
      const name = index === 0 ? 'first' : 'last'
      expect(frame.addRepresentation).toHaveBeenNthCalledWith(1, {
        scaleFactor: 1,
        dataURL: `data:image/png;base64,${name}-1x`
      })
      expect(frame.addRepresentation).toHaveBeenNthCalledWith(2, {
        scaleFactor: 2,
        dataURL: `data:image/png;base64,${name}-2x`
      })
      expect(frame.setTemplateImage).toHaveBeenCalledWith(true)
    }
    renderer.dispose()
    expect(destroy).toHaveBeenCalledOnce()
  })
})
