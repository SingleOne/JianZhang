import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { observeContentHeight } from './observe-content-height'

let height: number
let width: number
let notifyResize: () => void
const disconnect = vi.fn()
const observe = vi.fn()
const element = {
  getBoundingClientRect: () => ({ height, width })
} as HTMLElement

beforeEach(() => {
  height = 177.25
  width = 560
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        notifyResize = callback
      }
      observe = observe
      disconnect = disconnect
    }
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('popover content height', () => {
  it('reports the fractional CSS height so the main process can scale before rounding', () => {
    const onHeight = vi.fn()
    observeContentHeight(element, onHeight)
    expect(observe).toHaveBeenCalledWith(element, { box: 'border-box' })
    expect(onHeight).toHaveBeenCalledExactlyOnceWith(177.25)
  })

  it('updates for later growth and shrinkage from content or stylesheet changes', () => {
    const onHeight = vi.fn()
    observeContentHeight(element, onHeight)
    height = 314.5
    notifyResize()
    height = 143.25
    notifyResize()
    expect(onHeight.mock.calls.map(([value]) => value)).toEqual([177.25, 314.5, 143.25])
  })

  it('deduplicates equal bounds and releases the observer on cleanup', () => {
    const onHeight = vi.fn()
    const cleanup = observeContentHeight(element, onHeight)
    notifyResize()
    notifyResize()
    expect(onHeight).toHaveBeenCalledOnce()
    cleanup()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('reports again when a zoom change alters width without changing the CSS height', () => {
    const onHeight = vi.fn()
    observeContentHeight(element, onHeight)
    width = 614
    notifyResize()
    expect(onHeight.mock.calls).toEqual([[177.25], [177.25]])
  })
})
