import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMenuBarDisclosureAnimator } from './menu-bar-disclosure-animation'

const fields = ['price', 'change', 'changePercent', 'todayProfit']
const animations: {
  element: TestElement
  keyframes: Keyframe[]
  finished: Promise<void>
  finish: () => void
  cancel: ReturnType<typeof vi.fn>
}[] = []

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height } as DOMRect
}

class TestElement {
  dataset: Record<string, string> = {}
  style: Record<string, string> = { opacity: '', overflow: '' }
  attributes: Record<string, string> = {}
  children: TestElement[] = []
  parent: TestElement | null = null
  className = ''
  hidden = false
  inert = false
  bounds = rect(0, 0, 0, 0)
  classList = { contains: (name: string) => this.className.split(' ').includes(name) }

  getBoundingClientRect() {
    return this.bounds
  }

  append(element: TestElement) {
    element.parent = this
    this.children.push(element)
  }

  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this)
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value
  }

  removeAttribute(name: string) {
    delete this.attributes[name]
    if (name === 'data-menu-bar-value') delete this.dataset.menuBarValue
  }

  querySelectorAll(selector: string): TestElement[] {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')])
    return descendants.filter((element) => {
      if (selector === '[data-menu-bar-row]') return element.dataset.menuBarRow !== undefined
      if (selector === '[data-menu-bar-value]') return element.dataset.menuBarValue !== undefined
      if (selector === '[data-menu-bar-flight]') return element.dataset.menuBarFlight !== undefined
      if (selector === '[data-menu-bar-exit]') return element.dataset.menuBarExit !== undefined
      if (selector === '[id]') return element.attributes.id !== undefined
      if (selector.startsWith('.')) return element.classList.contains(selector.slice(1))
      return true
    })
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null
  }

  cloneNode(deep: boolean): TestElement {
    const clone = new TestElement()
    clone.dataset = { ...this.dataset }
    clone.style = { ...this.style }
    clone.attributes = { ...this.attributes }
    clone.className = this.className
    clone.bounds = this.bounds
    if (deep) this.children.forEach((child) => clone.append(child.cloneNode(true)))
    return clone
  }

  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    expect(options.duration).toBe(320)
    let finish!: () => void
    let reject!: (reason: Error) => void
    const finished = new Promise<void>((resolve, rejectPromise) => {
      finish = resolve
      reject = rejectPromise
    })
    const animation = {
      element: this,
      keyframes,
      finished,
      finish,
      cancel: vi.fn(() => reject(new Error('cancelled')))
    }
    animations.push(animation)
    return animation
  }
}

function stockRow(quoteId: string, initiallyExpanded: boolean) {
  const row = new TestElement()
  row.dataset.menuBarRow = quoteId
  const render = (expanded: boolean) => {
    row.children = []
    row.className = expanded ? 'is-expanded' : ''
    row.bounds = rect(10, 20, 540, expanded ? 260 : 40)
    const details = new TestElement()
    details.className = 'menu-bar-stock-details'
    details.hidden = !expanded
    details.bounds = rect(22, 76, 516, 196)
    details.setAttribute('id', `${quoteId}-details`)
    fields.forEach((field, index) => {
      const value = new TestElement()
      value.dataset.menuBarValue = field
      value.bounds = expanded
        ? rect(22 + index * 100, 84, 80, 30)
        : rect(250 + index * 60, 30, 40, 18)
      Object.assign(value.style, {
        fontSize: expanded ? '24px' : '15px',
        fontWeight: expanded ? '700' : '650',
        lineHeight: expanded ? '30px' : '18px',
        letterSpacing: expanded ? '-0.5px' : 'normal'
      })
      const container = expanded ? details : row
      container.append(value)
    })
    row.append(details)
  }
  render(initiallyExpanded)
  return { row, render }
}

function setup(initiallyExpanded = false) {
  const panel = new TestElement()
  const stock = stockRow('1.600519', initiallyExpanded)
  panel.append(stock.row)
  return {
    ...stock,
    panel,
    animator: createMenuBarDisclosureAnimator(panel as unknown as HTMLElement)
  }
}

beforeEach(() => {
  animations.length = 0
  vi.stubGlobal('document', { hidden: false })
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
  vi.stubGlobal('getComputedStyle', (element: TestElement) => ({
    fontFamily: 'sans-serif',
    fontSize: element.style.fontSize || '15px',
    fontWeight: element.style.fontWeight || '600',
    fontStyle: 'normal',
    lineHeight: element.style.lineHeight || '18px',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: element.style.letterSpacing || 'normal',
    color: 'red',
    opacity: element.style.opacity || '1'
  }))
})

afterEach(() => vi.unstubAllGlobals())

describe('menu bar disclosure animation', () => {
  it('moves all four numbers into the expanded layout and restores them on completion', async () => {
    const { row, render, animator } = setup()
    animator.transition(() => render(true))
    expect(row.querySelectorAll('[data-menu-bar-flight]')).toHaveLength(4)
    expect(
      row.querySelectorAll('[data-menu-bar-value]').every((value) => value.style.opacity === '0')
    ).toBe(true)
    expect(animations.find((animation) => animation.element === row)?.keyframes).toEqual([
      { height: '40px' },
      { height: '260px' }
    ])
    animations.forEach((animation) => animation.finish())
    await Promise.all(animations.map((animation) => animation.finished))
    expect(row.querySelectorAll('[data-menu-bar-flight]')).toHaveLength(0)
    expect(
      row.querySelectorAll('[data-menu-bar-value]').every((value) => value.style.opacity === '')
    ).toBe(true)
    expect(row.style.overflow).toBe('')
  })

  it('keeps an inaccessible outgoing detail snapshot until the reverse animation ends', () => {
    const { row, render, animator } = setup(true)
    animator.transition(() => render(false))
    const exit = row.children.find((child) => child.inert)!
    expect(exit.attributes['aria-hidden']).toBe('true')
    expect(exit.attributes.id).toBeUndefined()
    expect(exit.querySelectorAll('[id]')).toHaveLength(0)
    expect(exit.querySelectorAll('[data-menu-bar-value]')).toHaveLength(0)
    expect(row.querySelectorAll('[data-menu-bar-flight]')).toHaveLength(4)
    animator.cancel()
    expect(row.children).not.toContain(exit)
    expect(row.querySelectorAll('[data-menu-bar-flight]')).toHaveLength(0)
    expect(row.style.overflow).toBe('')
  })

  it('reverses from the visible flying numbers rather than jumping back to a layout endpoint', () => {
    const { row, render, animator } = setup()
    animator.transition(() => render(true))
    const previousAnimations = [...animations]
    const price = row.querySelectorAll('[data-menu-bar-flight]')[0]
    price.bounds = rect(80, 54, 60, 24)
    Object.assign(price.style, {
      fontSize: '20px',
      fontWeight: '675',
      lineHeight: '24px',
      letterSpacing: '-0.25px'
    })
    row.bounds = rect(10, 20, 540, 140)
    animator.transition(() => render(false))
    const nextPrice = row.querySelectorAll('[data-menu-bar-flight]')[0]
    const flight = animations.find((animation) => animation.element === nextPrice)!
    expect(flight.keyframes[0]).toMatchObject({
      transform: 'translate(-170px, 24px)',
      fontSize: '20px',
      fontWeight: '675',
      lineHeight: '24px',
      letterSpacing: '-0.25px'
    })
    expect(previousAnimations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(
      true
    )
    expect(row.querySelectorAll('[data-menu-bar-flight]')).not.toContain(price)
    expect(row.querySelectorAll('[data-menu-bar-flight]')).toHaveLength(4)
    animator.cancel()
  })

  it.each([false, true])(
    'interpolates actual typography when initially expanded is %s',
    (expanded) => {
      const { row, render, animator } = setup(expanded)
      animator.transition(() => render(!expanded))
      const price = row.querySelectorAll('[data-menu-bar-flight]')[0]
      const flight = animations.find((animation) => animation.element === price)!
      expect(flight.keyframes[0]).toMatchObject({
        fontSize: expanded ? '24px' : '15px',
        fontWeight: expanded ? '700' : '650',
        lineHeight: expanded ? '30px' : '18px',
        letterSpacing: expanded ? '-0.5px' : '0px'
      })
      expect(flight.keyframes[1]).toMatchObject({
        fontSize: expanded ? '15px' : '24px',
        fontWeight: expanded ? '650' : '700',
        lineHeight: expanded ? '18px' : '30px',
        letterSpacing: expanded ? '0px' : '-0.5px'
      })
      expect(flight.keyframes.every((frame) => !String(frame.transform).includes('scale'))).toBe(
        true
      )
      animator.cancel()
    }
  )

  it('animates both affected stocks when switching the expanded row', () => {
    const { row, render, panel, animator } = setup(true)
    const second = stockRow('0.300750', false)
    panel.append(second.row)
    animator.transition(() => {
      render(false)
      second.render(true)
    })
    expect(row.querySelectorAll('[data-menu-bar-flight]')).toHaveLength(4)
    expect(second.row.querySelectorAll('[data-menu-bar-flight]')).toHaveLength(4)
    animator.cancel()
    expect(panel.querySelectorAll('[data-menu-bar-flight]')).toHaveLength(0)
  })

  it('reopens from the visible fading detail snapshot without restarting the fade', () => {
    const { row, render, animator } = setup(true)
    animator.transition(() => render(false))
    const exit = row.querySelector('[data-menu-bar-exit]')!
    exit.style.opacity = '0.4'
    exit.bounds = rect(22, 72, 516, 196)
    row.bounds = rect(10, 20, 540, 150)
    animator.transition(() => render(true))
    const details = row.querySelector('.menu-bar-stock-details')!
    const entry = animations.find((animation) => animation.element === details)!
    expect(entry.keyframes[0]).toEqual({ opacity: '0.4', transform: 'translate(0px, -4px)' })
    expect(row.querySelectorAll('[data-menu-bar-exit]')).toHaveLength(0)
    animator.cancel()
  })

  it.each(['reduced motion', 'hidden panel'])('switches immediately for %s', (reason) => {
    const { row, render, animator } = setup()
    if (reason === 'reduced motion') {
      vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    } else {
      vi.stubGlobal('document', { hidden: true })
    }
    animator.transition(() => render(true))
    expect(row.classList.contains('is-expanded')).toBe(true)
    expect(animations).toHaveLength(0)
    expect(row.querySelectorAll('[data-menu-bar-flight]')).toHaveLength(0)
  })
})
