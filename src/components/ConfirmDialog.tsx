import { AlertTriangle, X } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

export interface ConfirmDialogOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  dismissible?: boolean
}

type ConfirmDialogRequest = ConfirmDialogOptions & {
  resolve: (confirmed: boolean) => void
}

type ConfirmDialogFunction = (options: ConfirmDialogOptions) => Promise<boolean>

const ConfirmDialogContext = createContext<ConfirmDialogFunction | null>(null)

function ActiveConfirmDialog({
  request,
  onFinish
}: {
  request: ConfirmDialogRequest
  onFinish: (confirmed: boolean) => void
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelButtonRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && request.dismissible !== false) onFinish(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onFinish, request.dismissible])

  return createPortal(
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onMouseDown={() => {
        if (request.dismissible !== false) onFinish(false)
      }}
    >
      <section
        className={`confirm-dialog ${request.tone === 'danger' ? 'is-danger' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span className="confirm-dialog-icon" aria-hidden="true">
            <AlertTriangle size={19} />
          </span>
          <div>
            <h2 id="confirm-dialog-title">{request.title}</h2>
            <p id="confirm-dialog-message">{request.message}</p>
          </div>
          {request.dismissible !== false ? (
            <button
              className="icon-button confirm-dialog-close"
              type="button"
              onClick={() => onFinish(false)}
              aria-label="关闭确认弹窗"
              title="关闭"
            >
              <X size={16} />
            </button>
          ) : null}
        </header>
        <footer>
          <button
            ref={cancelButtonRef}
            className="secondary-button"
            type="button"
            onClick={() => onFinish(false)}
          >
            {request.cancelLabel ?? '取消'}
          </button>
          <button
            className={request.tone === 'danger' ? 'danger-button' : 'primary-button'}
            type="button"
            onClick={() => onFinish(true)}
          >
            {request.confirmLabel ?? '确认'}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  )
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmDialogRequest | null>(null)

  const confirm = useCallback<ConfirmDialogFunction>((options) => {
    return new Promise<boolean>((resolve) => setRequest({ ...options, resolve }))
  }, [])

  const finish = useCallback(
    (confirmed: boolean) => {
      request?.resolve(confirmed)
      setRequest(null)
    },
    [request]
  )

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      {request ? <ActiveConfirmDialog request={request} onFinish={finish} /> : null}
    </ConfirmDialogContext.Provider>
  )
}

export function useConfirmDialog(): ConfirmDialogFunction {
  const confirm = useContext(ConfirmDialogContext)
  if (!confirm) throw new Error('useConfirmDialog 必须在 ConfirmDialogProvider 内使用')
  return confirm
}
