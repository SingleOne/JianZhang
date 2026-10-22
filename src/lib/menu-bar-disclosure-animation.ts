const ANIMATION_OPTIONS: KeyframeAnimationOptions = {
  duration: 320,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
}

interface ValueSnapshot {
  element: HTMLElement
  bounds: DOMRect
  color: string
  typography: Record<string, string>
}

interface RowSnapshot {
  element: HTMLElement
  bounds: DOMRect
  expanded: boolean
  values: Map<string, ValueSnapshot>
  details: { element: HTMLElement; bounds: DOMRect; opacity: string } | null
}

function readRows(panel: HTMLElement): Map<string, RowSnapshot> {
  return new Map(
    [...panel.querySelectorAll<HTMLElement>('[data-menu-bar-row]')].map((element) => {
      const values = new Map<string, ValueSnapshot>()
      // A flight already in progress is the visible source for a quick reversal.
      for (const selector of ['[data-menu-bar-value]', '[data-menu-bar-flight]']) {
        for (const value of element.querySelectorAll<HTMLElement>(selector)) {
          const bounds = value.getBoundingClientRect()
          if (!bounds.width || !bounds.height) continue
          const style = getComputedStyle(value)
          values.set(value.dataset.menuBarFlight ?? value.dataset.menuBarValue!, {
            element: value,
            bounds,
            color: style.color,
            typography: {
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              fontStyle: style.fontStyle,
              lineHeight: style.lineHeight,
              fontVariantNumeric: style.fontVariantNumeric,
              letterSpacing: style.letterSpacing === 'normal' ? '0px' : style.letterSpacing
            }
          })
        }
      }
      const currentDetails = element.querySelector<HTMLElement>('.menu-bar-stock-details')
      const details =
        currentDetails && !currentDetails.hidden
          ? currentDetails
          : element.querySelector<HTMLElement>('[data-menu-bar-exit]')
      return [
        element.dataset.menuBarRow!,
        {
          element,
          bounds: element.getBoundingClientRect(),
          expanded: element.classList.contains('is-expanded'),
          values,
          details: details
            ? {
                element: details,
                bounds: details.getBoundingClientRect(),
                opacity: getComputedStyle(details).opacity
              }
            : null
        }
      ]
    })
  )
}

export function createMenuBarDisclosureAnimator(panel: HTMLElement) {
  let active: { animations: Animation[]; cleanups: (() => void)[] } | null = null

  const cancel = () => {
    const previous = active
    active = null
    previous?.animations.forEach((animation) => animation.cancel())
    previous?.cleanups.forEach((cleanup) => cleanup())
  }

  const transition = (update: () => void) => {
    if (document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      cancel()
      update()
      return
    }

    const before = readRows(panel)
    // Preserve outgoing details before React unmounts them.
    const exits = new Map(
      [...before].flatMap(([key, row]) =>
        row.details ? [[key, row.details.element.cloneNode(true) as HTMLElement] as const] : []
      )
    )
    cancel()
    update()
    const after = readRows(panel)
    const session = { animations: [] as Animation[], cleanups: [] as (() => void)[] }
    active = session
    const animate = (element: HTMLElement, keyframes: Keyframe[]) => {
      session.animations.push(element.animate(keyframes, ANIMATION_OPTIONS))
    }

    for (const [key, to] of after) {
      const from = before.get(key)
      if (!from || from.expanded === to.expanded) continue

      const overflow = to.element.style.overflow
      to.element.style.overflow = 'hidden'
      session.cleanups.push(() => (to.element.style.overflow = overflow))
      animate(to.element, [
        { height: `${from.bounds.height}px` },
        { height: `${to.bounds.height}px` }
      ])

      if (to.details) {
        const x = from.details
          ? from.details.bounds.left - from.bounds.left - (to.details.bounds.left - to.bounds.left)
          : 0
        const y = from.details
          ? from.details.bounds.top - from.bounds.top - (to.details.bounds.top - to.bounds.top)
          : 8
        animate(to.details.element, [
          { opacity: from.details?.opacity ?? 0, transform: `translate(${x}px, ${y}px)` },
          { opacity: 1, transform: 'translate(0, 0)' }
        ])
      } else if (from.details) {
        const exit = exits.get(key)!
        exit.dataset.menuBarExit = ''
        exit.removeAttribute('id')
        exit.setAttribute('aria-hidden', 'true')
        exit.inert = true
        exit.querySelectorAll<HTMLElement>('[data-menu-bar-value]').forEach((element) => {
          element.style.visibility = 'hidden'
          element.removeAttribute('data-menu-bar-value')
        })
        Object.assign(exit.style, {
          position: 'absolute',
          top: `${from.details.bounds.top - from.bounds.top}px`,
          left: `${from.details.bounds.left - from.bounds.left}px`,
          width: `${from.details.bounds.width}px`,
          height: `${from.details.bounds.height}px`,
          margin: '0',
          pointerEvents: 'none'
        })
        to.element.append(exit)
        session.cleanups.push(() => exit.remove())
        animate(exit, [
          { opacity: from.details.opacity, transform: 'translateY(0)' },
          { opacity: 0, transform: 'translateY(-8px)' }
        ])
      }

      for (const [field, target] of to.values) {
        const source = from.values.get(field)
        if (!source) continue
        const flight = target.element.cloneNode(true) as HTMLElement
        flight.removeAttribute('data-menu-bar-value')
        flight.dataset.menuBarFlight = field
        flight.setAttribute('aria-hidden', 'true')
        Object.assign(flight.style, {
          position: 'absolute',
          left: `${target.bounds.left - to.bounds.left}px`,
          top: `${target.bounds.top - to.bounds.top}px`,
          width: `${target.bounds.width}px`,
          height: `${target.bounds.height}px`,
          margin: '0',
          ...target.typography,
          color: target.color,
          textAlign: 'left',
          whiteSpace: 'nowrap',
          transformOrigin: 'top left',
          pointerEvents: 'none',
          zIndex: '2'
        })
        const opacity = target.element.style.opacity
        target.element.style.opacity = '0'
        to.element.append(flight)
        session.cleanups.push(() => {
          target.element.style.opacity = opacity
          flight.remove()
        })
        const x = source.bounds.left - from.bounds.left - (target.bounds.left - to.bounds.left)
        const y = source.bounds.top - from.bounds.top - (target.bounds.top - to.bounds.top)
        animate(flight, [
          {
            transform: `translate(${x}px, ${y}px)`,
            color: source.color,
            fontSize: source.typography.fontSize,
            fontWeight: source.typography.fontWeight,
            lineHeight: source.typography.lineHeight,
            letterSpacing: source.typography.letterSpacing
          },
          {
            transform: 'translate(0, 0)',
            color: target.color,
            fontSize: target.typography.fontSize,
            fontWeight: target.typography.fontWeight,
            lineHeight: target.typography.lineHeight,
            letterSpacing: target.typography.letterSpacing
          }
        ])
      }
    }

    void Promise.all(session.animations.map((animation) => animation.finished)).then(
      () => {
        if (active === session) cancel()
      },
      () => {}
    )
  }

  return { transition, cancel }
}
