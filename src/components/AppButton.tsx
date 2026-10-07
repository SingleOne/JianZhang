import type { ComponentProps } from 'react'

type AppButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'text' | 'icon' | 'plain'
}

export function AppButton({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: AppButtonProps) {
  const variantClass =
    variant === 'plain'
      ? ''
      : variant === 'danger'
        ? 'secondary-button app-button-danger'
        : `${variant}-button`
  return <button {...props} type={type} className={`${variantClass} ${className}`.trim()} />
}
