export function observeContentHeight(element: HTMLElement, onHeight: (height: number) => void) {
  let previousHeight = -1
  let previousWidth = -1
  const updateHeight = () => {
    const { height, width } = element.getBoundingClientRect()
    // Zoom can change the CSS width while leaving the CSS height unchanged.
    if (height === previousHeight && width === previousWidth) return
    previousHeight = height
    previousWidth = width
    onHeight(height)
  }
  const observer = new ResizeObserver(updateHeight)
  observer.observe(element, { box: 'border-box' })
  updateHeight()
  return () => observer.disconnect()
}
