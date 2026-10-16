import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import './Tooltip.css'

interface TooltipProps {
  children: ReactElement
  content: ReactNode
}

interface TooltipTargetProps {
  'aria-describedby'?: string
  'data-app-tooltip-trigger'?: string
  tabIndex?: number
  onBlur?: (event: FocusEvent<Element>) => void
  onFocus?: (event: FocusEvent<Element>) => void
  onKeyDown?: (event: KeyboardEvent<Element>) => void
  onPointerEnter?: (event: PointerEvent<Element>) => void
  onPointerLeave?: (event: PointerEvent<Element>) => void
}

interface TooltipPosition {
  left: number
  top: number
  originLeft: number
  originTop: number
  placement: 'top' | 'bottom'
}

const TOOLTIP_ENTER_DELAY_MS = 500
const TOOLTIP_EXIT_DURATION_MS = 360
let closeActiveTooltip: ((immediate?: boolean) => void) | null = null

export function Tooltip({ children, content }: TooltipProps) {
  const target = children as ReactElement<TooltipTargetProps>
  const hasContent =
    content !== null && content !== undefined && content !== false && content !== ''
  const triggerRef = useRef<Element | null>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const enterTimerRef = useRef<number | undefined>(undefined)
  const exitTimerRef = useRef<number | undefined>(undefined)
  const enterFrameRef = useRef<number | undefined>(undefined)
  const enteringRef = useRef(false)
  const pointerInsideRef = useRef(false)
  const tooltipId = useId()
  const [open, setOpen] = useState(false)
  const [rendered, setRendered] = useState(false)
  const [entryRevision, setEntryRevision] = useState(0)
  const [position, setPosition] = useState<TooltipPosition | null>(null)

  const showTooltip = (trigger: Element) => {
    triggerRef.current = trigger
    window.clearTimeout(exitTimerRef.current)
    exitTimerRef.current = undefined
    if (enteringRef.current) return
    if (!open) {
      if (closeActiveTooltip && closeActiveTooltip !== startExit) closeActiveTooltip(true)
      closeActiveTooltip = startExit
      enteringRef.current = true
      setOpen(false)
      setRendered(true)
      setEntryRevision((revision) => revision + 1)
      return
    }
  }

  const scheduleShowTooltip = (trigger: Element) => {
    window.clearTimeout(exitTimerRef.current)
    exitTimerRef.current = undefined
    if (open || enteringRef.current) return
    window.clearTimeout(enterTimerRef.current)
    enterTimerRef.current = window.setTimeout(() => {
      enterTimerRef.current = undefined
      showTooltip(trigger)
    }, TOOLTIP_ENTER_DELAY_MS)
  }

  const startExit = useCallback((immediate = false) => {
    enteringRef.current = false
    window.clearTimeout(enterTimerRef.current)
    enterTimerRef.current = undefined
    window.cancelAnimationFrame(enterFrameRef.current ?? 0)
    enterFrameRef.current = undefined
    setOpen(false)
    window.clearTimeout(exitTimerRef.current)
    const finishExit = () => {
      if (closeActiveTooltip === startExit) closeActiveTooltip = null
      setRendered(false)
      setPosition(null)
      exitTimerRef.current = undefined
    }
    if (immediate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finishExit()
      return
    }
    exitTimerRef.current = window.setTimeout(() => {
      finishExit()
    }, TOOLTIP_EXIT_DURATION_MS)
  }, [])

  const hideTooltip = () => {
    startExit()
  }

  const handlePointerEnter = (event: PointerEvent<Element>) => {
    target.props.onPointerEnter?.(event)
    if (
      event.target instanceof Element &&
      event.target.closest('[data-app-tooltip-trigger]') !== event.currentTarget
    )
      return
    pointerInsideRef.current = true
    scheduleShowTooltip(event.currentTarget)
  }

  const handlePointerLeave = (event: PointerEvent<Element>) => {
    target.props.onPointerLeave?.(event)
    pointerInsideRef.current = false
    hideTooltip()
  }

  useLayoutEffect(() => {
    if (!rendered || (!open && !enteringRef.current)) return
    const trigger = triggerRef.current
    const tooltip = tooltipRef.current
    if (!trigger || !tooltip) return
    const rect = trigger.getBoundingClientRect()
    const tooltipRect = tooltip.getBoundingClientRect()
    const halfWidth = tooltipRect.width / 2
    const spaceAbove = rect.top - 8
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const placement =
      spaceAbove >= tooltipRect.height || spaceAbove >= spaceBelow ? 'top' : 'bottom'
    setPosition({
      left: Math.max(
        12 + halfWidth,
        Math.min(window.innerWidth - 12 - halfWidth, rect.left + rect.width / 2)
      ),
      top: placement === 'top' ? rect.top - 8 : rect.bottom + 8,
      originLeft: rect.left + rect.width / 2,
      originTop: rect.top + rect.height / 2,
      placement
    })
    if (enteringRef.current) {
      window.cancelAnimationFrame(enterFrameRef.current ?? 0)
      enterFrameRef.current = window.requestAnimationFrame(() => {
        enterFrameRef.current = window.requestAnimationFrame(() => {
          enteringRef.current = false
          enterFrameRef.current = undefined
          setOpen(true)
        })
      })
    }
  }, [content, entryRevision, open, rendered])

  useLayoutEffect(() => {
    if (!rendered) return
    const closeTooltip = () => {
      if (open || enteringRef.current) startExit()
    }
    window.addEventListener('resize', closeTooltip)
    window.addEventListener('scroll', closeTooltip, true)
    return () => {
      window.removeEventListener('resize', closeTooltip)
      window.removeEventListener('scroll', closeTooltip, true)
    }
  }, [open, rendered, startExit])

  useEffect(
    () => () => {
      if (closeActiveTooltip === startExit) closeActiveTooltip = null
      window.clearTimeout(exitTimerRef.current)
      window.clearTimeout(enterTimerRef.current)
      enterTimerRef.current = undefined
      window.cancelAnimationFrame(enterFrameRef.current ?? 0)
    },
    [startExit]
  )

  useEffect(() => {
    if (
      !hasContent &&
      (open || rendered || enteringRef.current || enterTimerRef.current !== undefined)
    )
      startExit(true)
  }, [hasContent, open, rendered, startExit])

  if (!hasContent) {
    return children
  }

  const describedBy = open
    ? [target.props['aria-describedby'], tooltipId].filter(Boolean).join(' ')
    : target.props['aria-describedby']

  return (
    <>
      {cloneElement(target, {
        'aria-describedby': describedBy,
        'data-app-tooltip-trigger': '',
        tabIndex: target.props.tabIndex ?? 0,
        onPointerEnter: handlePointerEnter,
        onPointerLeave: handlePointerLeave,
        onFocus: (event) => {
          target.props.onFocus?.(event)
          if (
            event.target instanceof Element &&
            event.target.closest('[data-app-tooltip-trigger]') !== event.currentTarget
          )
            return
          scheduleShowTooltip(event.currentTarget)
        },
        onBlur: (event) => {
          target.props.onBlur?.(event)
          if (
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          )
            return
          if (!pointerInsideRef.current) hideTooltip()
        },
        onKeyDown: (event) => {
          target.props.onKeyDown?.(event)
          if (event.key === 'Escape') hideTooltip()
        }
      })}
      {rendered
        ? createPortal(
            <span
              ref={tooltipRef}
              id={tooltipId}
              className="app-tooltip-content"
              data-placement={position?.placement ?? 'top'}
              data-state={open && position ? 'open' : enteringRef.current ? 'preparing' : 'closed'}
              role="tooltip"
              style={
                position
                  ? {
                      left: open ? position.left : position.originLeft,
                      top: open ? position.top : position.originTop
                    }
                  : { left: 0, top: 0, visibility: 'hidden' }
              }
            >
              {content}
            </span>,
            document.body
          )
        : null}
    </>
  )
}
