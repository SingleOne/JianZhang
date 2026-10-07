import type { ComponentProps, InputHTMLAttributes } from 'react'

export function AppInput(props: ComponentProps<'input'>) {
  return <input {...props} />
}

type AppSwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & {
  label: string
  className?: string
}

export function AppSwitch({ label, className = '', ...props }: AppSwitchProps) {
  return (
    <label className={className}>
      <span>{label}</span>
      <AppInput {...props} type="checkbox" role="switch" />
      <i aria-hidden="true" />
    </label>
  )
}
