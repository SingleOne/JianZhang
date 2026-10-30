import { AlertTriangle, LoaderCircle, X } from 'lucide-react'
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
import { AppButton } from './AppButton'

export interface ConfirmDialogOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'warning' | 'danger'
  dismissible?: boolean
  loadingLabel?: string
  onConfirm?: () => Promise<void>
}

type ConfirmDialogRequest = ConfirmDialogOptions & {
  resolve: (confirmed: boolean) => void
  reject: (reason: unknown) => void
}

type ConfirmDialogFunction = (options: ConfirmDialogOptions) => Promise<boolean>

const ConfirmDialogContext = createContext<ConfirmDialogFunction | null>(null)

function ActiveConfirmDialog({
  request,
  loading,
  onFinish
}: {
  request: ConfirmDialogRequest
  loading: boolean
  onFinish: (confirmed: boolean) => void
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const dismissible = request.dismissible !== false && !loading

  useEffect(() => {
    cancelButtonRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) onFinish(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onFinish, dismissible])

  return createPortal(
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onMouseDown={() => {
        if (dismissible) onFinish(false)
      }}
    >
      <section
        className={`confirm-dialog ${request.tone === 'danger' ? 'is-danger' : request.tone === 'warning' ? 'is-warning' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-busy={loading}
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
            <AppButton
              variant="icon"
              className="confirm-dialog-close"
              type="button"
              disabled={loading}
              onClick={() => onFinish(false)}
              aria-label="关闭确认弹窗"
              title="关闭"
            >
              <X size={16} />
            </AppButton>
          ) : null}
        </header>
        <footer>
          <AppButton
            ref={cancelButtonRef}
            type="button"
            disabled={loading}
            onClick={() => onFinish(false)}
          >
            {request.cancelLabel ?? '取消'}
          </AppButton>
          <AppButton
            variant="plain"
            className={
              request.tone === 'danger'
                ? 'danger-button'
                : request.tone === 'warning'
                  ? 'warning-button'
                  : 'primary-button'
            }
            type="button"
            disabled={loading}
            onClick={() => onFinish(true)}
          >
            {loading ? <LoaderCircle size={14} className="is-spinning" aria-hidden="true" /> : null}
            {loading ? (request.loadingLabel ?? '处理中…') : (request.confirmLabel ?? '确认')}
          </AppButton>
        </footer>
      </section>
    </div>,
    document.body
  )
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmDialogRequest | null>(null)
  const [loading, setLoading] = useState(false)

  const confirm = useCallback<ConfirmDialogFunction>((options) => {
    return new Promise<boolean>((resolve, reject) => setRequest({ ...options, resolve, reject }))
  }, [])

  const finish = useCallback(
    async (confirmed: boolean) => {
      if (!request || loading) return
      if (!confirmed || !request.onConfirm) {
        request.resolve(confirmed)
        setRequest(null)
        return
      }

      setLoading(true)
      try {
        await request.onConfirm()
        request.resolve(true)
      } catch (reason) {
        request.reject(reason)
      } finally {
        setLoading(false)
        setRequest(null)
      }
    },
    [request, loading]
  )

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      {request ? (
        <ActiveConfirmDialog request={request} loading={loading} onFinish={finish} />
      ) : null}
    </ConfirmDialogContext.Provider>
  )
}

export function useConfirmDialog(): ConfirmDialogFunction {
  const confirm = useContext(ConfirmDialogContext)
  if (!confirm) throw new Error('useConfirmDialog 必须在 ConfirmDialogProvider 内使用')
  return confirm
}
