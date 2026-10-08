import { AlertTriangle, Info } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AppButton } from './AppButton'
import './AppHint.css'

interface AppHintProps {
  content: string
  label?: string
  tone?: 'info' | 'warning' | 'error'
}

export function AppHint({ content, label = '查看说明', tone = 'info' }: AppHintProps) {
  const tooltipId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const open = hovered || focused

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !tooltipRef.current) return
    const trigger = triggerRef.current.getBoundingClientRect()
    const tooltip = tooltipRef.current.getBoundingClientRect()
    const left = Math.max(
      8,
      Math.min(
        trigger.left + trigger.width / 2 - tooltip.width / 2,
        window.innerWidth - tooltip.width - 8
      )
    )
    const below = trigger.bottom + 8
    const top =
      below + tooltip.height <= window.innerHeight - 8
        ? below
        : Math.max(8, trigger.top - tooltip.height - 8)
    setPosition({ left, top })
  }, [open, content])

  useEffect(() => {
    if (!open) return
    const hide = () => {
      setHovered(false)
      setFocused(false)
    }
    window.addEventListener('resize', hide)
    document.addEventListener('scroll', hide, true)
    return () => {
      window.removeEventListener('resize', hide)
      document.removeEventListener('scroll', hide, true)
    }
  }, [open])

  return (
    <>
      <AppButton
        variant="plain"
        className={`app-hint-trigger is-${tone}`}
        ref={triggerRef}
        aria-label={`${label}：${content}`}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={(event) => setFocused(event.currentTarget.matches(':focus-visible'))}
        onBlur={() => setFocused(false)}
      >
        {tone === 'info' ? (
          <Info size={14} aria-hidden="true" />
        ) : (
          <AlertTriangle size={14} aria-hidden="true" />
        )}
      </AppButton>
      {open
        ? createPortal(
            <div
              ref={tooltipRef}
              className={`app-hint-tooltip is-${tone}`}
              id={tooltipId}
              role="tooltip"
              style={position}
            >
              {content}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
