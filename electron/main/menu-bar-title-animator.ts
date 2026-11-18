import { systemPreferences, type Tray } from 'electron'
import type { MenuBarPresentation } from '../../src/lib/menu-bar'
import { createMenuBarIcon } from './tray-icons'
import { MenuBarTitleRenderer } from './menu-bar-title-renderer'

const TRANSITION_MS = 280

function visibleLength(value: string): number {
  return value
    .split('\u001b[')
    .map((part, index) => (index === 0 ? part : part.slice(part.indexOf('m') + 1)))
    .join('').length
}

export class MenuBarTitleAnimator {
  private readonly renderer = new MenuBarTitleRenderer()
  private readonly icon = createMenuBarIcon()
  private timer: NodeJS.Timeout | null = null
  private version = 0
  private current: MenuBarPresentation | null = null
  private pending: MenuBarPresentation | null = null
  private imageMode = false
  private width = 0
  private valueWidth = 0

  constructor(
    private readonly tray: Tray,
    private readonly onResize: () => void
  ) {}

  update(presentation: MenuBarPresentation, rotating: boolean, selectionChanged = false): void {
    if (selectionChanged) {
      this.width = 0
      this.valueWidth = 0
      this.imageMode = false
    }
    const imageMode =
      rotating && presentation.quoteId !== null && presentation.stockTitles.length > 1
    // Finish a stock transition before applying another quote for that stock.
    if (
      this.timer &&
      !selectionChanged &&
      imageMode &&
      this.current?.quoteId === presentation.quoteId
    ) {
      this.pending = presentation
      return
    }
    this.cancel()
    const version = this.version
    if (!imageMode) {
      this.imageMode = false
      this.width = 0
      this.valueWidth = 0
      this.current = presentation
      this.renderer.dispose()
      this.tray.setImage(this.icon)
      this.tray.setTitle(presentation.title, { fontType: 'monospacedDigit' })
      this.onResize()
      return
    }
    const animate =
      this.imageMode &&
      this.current?.quoteId !== presentation.quoteId &&
      !systemPreferences.getAnimationSettings().prefersReducedMotion
    const title = presentation.stockTitles.find(({ quoteId }) => quoteId === presentation.quoteId)!
    const previousTitle = animate
      ? this.current!.stockTitles.find(({ quoteId }) => quoteId === this.current!.quoteId)!.label
      : null
    const valueWidth = Math.max(
      this.valueWidth,
      ...presentation.stockTitles.map(({ values }) => visibleLength(values))
    )
    void this.renderer
      .render({
        title: title.label,
        previousTitle,
        titles: presentation.stockTitles.map(({ label }) => label),
        minimumWidth: this.width,
        icon: this.icon.toDataURL({ scaleFactor: 2 })
      })
      .then((frames) => {
        if (version !== this.version || frames.length === 0) return
        this.current = presentation
        this.imageMode = true
        this.width = frames[0].getSize().width
        this.valueWidth = valueWidth
        // Keep colored quotes in native text: a template image can only contain
        // neutral content. Monospaced padding reserves the widest quote's space.
        this.tray.setTitle(title.values + ' '.repeat(valueWidth - visibleLength(title.values)), {
          fontType: 'monospaced'
        })
        this.tray.setImage(frames[0])
        this.onResize()
        if (frames.length === 1) return
        const startedAt = Date.now()
        this.timer = setInterval(() => {
          const progress = Math.min(1, (Date.now() - startedAt) / TRANSITION_MS)
          this.tray.setImage(frames[Math.floor(progress * (frames.length - 1))])
          if (progress < 1) return
          clearInterval(this.timer!)
          this.timer = null
          const pending = this.pending
          this.pending = null
          if (pending) this.update(pending, true)
        }, 16)
      })
      .catch((error: unknown) => {
        if (version !== this.version) return
        console.error('菜单栏轮播动画绘制失败', error)
        this.update(presentation, false)
      })
  }

  dispose(): void {
    this.cancel()
    this.renderer.dispose()
  }

  private cancel(): void {
    this.version += 1
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.pending = null
  }
}
