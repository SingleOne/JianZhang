import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './CorporateActionPreviewDialog.css'

interface CorporateActionPreviewDialogProps {
  title: string
  closing: boolean
  children: ReactNode
  onClose: () => void
  onClosed: () => void
}

export function CorporateActionPreviewDialog({
  title,
  closing,
  children,
  onClose,
  onClosed
}: CorporateActionPreviewDialogProps) {
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const element = dialogRef.current
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element?.querySelector<HTMLButtonElement>('button[data-dialog-close]')?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        const expandedSelect = element?.querySelector<HTMLButtonElement>(
          'button[aria-haspopup="listbox"][aria-expanded="true"]'
        )
        if (expandedSelect) {
          expandedSelect.click()
          expandedSelect.focus()
          return
        }
        onClose()
      } else if (event.key === 'Tab') {
        if (element?.inert) {
          event.preventDefault()
          return
        }
        const controls = element?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)'
        )
        if (!controls?.length) return
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (!element?.contains(document.activeElement)) {
          event.preventDefault()
          const target = event.shiftKey ? last : first
          target.focus()
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.body.style.overflow = previousOverflow
      requestAnimationFrame(() => {
        if (!element?.isConnected && previousFocus?.isConnected) previousFocus.focus()
      })
    }
  }, [onClose])

  return createPortal(
    <div
      className={`corporate-action-preview-backdrop${closing ? ' is-closing' : ''}`}
      role="presentation"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className={`corporate-action-editor corporate-action-preview-dialog${closing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`公司行动影响预览：${title}`}
        inert={closing}
        onAnimationEnd={(event) => {
          if (
            closing &&
            event.target === event.currentTarget &&
            event.animationName === 'corporate-action-preview-out'
          ) {
            onClosed()
          }
        }}
      >
        {children}
      </section>
    </div>,
    document.body
  )
}
