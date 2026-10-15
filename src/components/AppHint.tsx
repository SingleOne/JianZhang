import { AlertTriangle, Info } from 'lucide-react'
import { AppButton } from './AppButton'
import { Tooltip } from './Tooltip'
import './AppHint.css'

interface AppHintProps {
  content: string
  label?: string
  tone?: 'info' | 'warning' | 'error'
}

export function AppHint({ content, label = '查看说明', tone = 'info' }: AppHintProps) {
  return (
    <Tooltip content={content}>
      <AppButton
        variant="plain"
        className={`app-hint-trigger is-${tone}`}
        aria-label={`${label}：${content}`}
      >
        {tone === 'info' ? (
          <Info size={14} aria-hidden="true" />
        ) : (
          <AlertTriangle size={14} aria-hidden="true" />
        )}
      </AppButton>
    </Tooltip>
  )
}
