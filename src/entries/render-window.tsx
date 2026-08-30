import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppThemeController } from '../components/AppThemeController'

export function renderWindow(content: ReactNode): void {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppThemeController />
      {content}
    </StrictMode>
  )
}
