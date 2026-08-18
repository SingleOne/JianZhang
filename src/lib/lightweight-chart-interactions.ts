import type { HandleScaleOptions, HandleScrollOptions, IChartApi } from 'lightweight-charts'

export const CTRL_WHEEL_HANDLE_SCROLL: HandleScrollOptions = {
  mouseWheel: false,
  pressedMouseMove: true,
  horzTouchDrag: true,
  vertTouchDrag: true
}

export const CTRL_WHEEL_HANDLE_SCALE: HandleScaleOptions = {
  mouseWheel: false,
  pinch: true,
  axisPressedMouseMove: false,
  axisDoubleClickReset: false
}

export function enableCtrlWheelZoom(
  chart: IChartApi,
  container: HTMLElement,
  getDataLength: () => number
): () => void {
  const handleWheel = (event: WheelEvent) => {
    if (!event.ctrlKey || event.deltaY === 0) return
    event.preventDefault()

    const range = chart.timeScale().getVisibleLogicalRange()
    const dataLength = getDataLength()
    if (!range || dataLength === 0) return

    const currentSpan = range.to - range.from
    const maximumSpan = Math.max(1, dataLength)
    const minimumSpan = Math.min(8, maximumSpan)
    const zoomFactor = event.deltaY > 0 ? 1.15 : 0.85
    const nextSpan = Math.min(maximumSpan, Math.max(minimumSpan, currentSpan * zoomFactor))
    if (Math.abs(nextSpan - currentSpan) < 0.01) return

    const bounds = container.getBoundingClientRect()
    const anchorRatio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
    const anchor = range.from + currentSpan * anchorRatio
    let from = anchor - nextSpan * anchorRatio
    let to = from + nextSpan

    if (from < 0) {
      to -= from
      from = 0
    }
    if (to > maximumSpan) {
      from -= to - maximumSpan
      to = maximumSpan
    }

    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, from), to })
  }

  container.addEventListener('wheel', handleWheel, { passive: false })
  return () => container.removeEventListener('wheel', handleWheel)
}
