import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './Tooltip.css'

interface TooltipProps {
  children: ReactNode
  content: ReactNode
}

interface TooltipPosition {
  left: number
  top: number
  placement: 'top' | 'bottom'
}

export function Tooltip({ children, content }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const hideTimerRef = useRef<number | undefined>(undefined)
  const tooltipId = useId()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<TooltipPosition | null>(null)

  const clearScheduledHide = () => {
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = undefined
  }

  const showTooltip = () => {
    clearScheduledHide()
    setOpen(true)
  }

  const hideTooltip = () => {
    clearScheduledHide()
    setOpen(false)
    setPosition(null)
  }

  const scheduleHide = () => {
    clearScheduledHide()
    hideTimerRef.current = window.setTimeout(() => {
      setOpen(false)
      setPosition(null)
    }, 120)
  }

  useLayoutEffect(() => {
    if (!open) return
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
      placement
    })
  }, [content, open])

  useEffect(() => {
    if (!open) return
    const closeTooltip = () => {
      setOpen(false)
      setPosition(null)
    }
    window.addEventListener('resize', closeTooltip)
    window.addEventListener('scroll', closeTooltip, true)
    return () => {
      window.removeEventListener('resize', closeTooltip)
      window.removeEventListener('scroll', closeTooltip, true)
    }
  }, [open])

  useEffect(() => () => window.clearTimeout(hideTimerRef.current), [])

  return (
    <span
      ref={triggerRef}
      className="app-tooltip-trigger"
      tabIndex={0}
      aria-describedby={open ? tooltipId : undefined}
      onPointerEnter={showTooltip}
      onPointerLeave={scheduleHide}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      onKeyDown={(event) => {
        if (event.key === 'Escape') hideTooltip()
      }}
    >
      {children}
      {open
        ? createPortal(
            <span
              ref={tooltipRef}
              id={tooltipId}
              className="app-tooltip-content"
              data-placement={position?.placement ?? 'top'}
              role="tooltip"
              style={
                position
                  ? { left: position.left, top: position.top }
                  : { left: 0, top: 0, visibility: 'hidden' }
              }
              onPointerEnter={clearScheduledHide}
              onPointerLeave={scheduleHide}
            >
              {content}
            </span>,
            document.body
          )
        : null}
    </span>
  )
}
