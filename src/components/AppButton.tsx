import type { ButtonHTMLAttributes } from 'react'

type AppButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger'
}

export function AppButton({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: AppButtonProps) {
  const variantClass =
    variant === 'danger' ? 'secondary-button app-button-danger' : `${variant}-button`
  return <button {...props} type={type} className={`${variantClass} ${className}`.trim()} />
}
