import type { JSX } from 'solid-js'
import { splitProps } from 'solid-js'
import { cn } from './cn'

export type IconButtonVariant = 'secondary' | 'ghost' | 'danger'
export type IconButtonSize = 'sm' | 'md'

export type IconButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: IconButtonVariant
  size?: IconButtonSize
  label: string
}

export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, ['variant', 'size', 'label', 'title', 'class', 'disabled', 'children'])
  const variant = () => local.variant ?? 'secondary'
  const size = () => local.size ?? 'sm'

  const base =
    'ring-focus motion-surface motion-pop inline-flex items-center justify-center rounded-xl border shadow-sm hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0 dark:shadow-none'

  const variants: Record<IconButtonVariant, string> = {
    secondary:
      'border-slate-200/90 bg-white/78 text-slate-700 hover:bg-white dark:border-slate-800 dark:bg-slate-950/62 dark:text-slate-200 dark:hover:bg-slate-900/90',
    ghost:
      'border-transparent bg-transparent text-slate-600 shadow-none hover:bg-slate-100/85 hover:shadow-none dark:text-slate-300 dark:hover:bg-slate-900/65',
    danger:
      'border-rose-300/70 bg-gradient-to-b from-rose-100 to-rose-200/85 text-rose-800 dark:border-rose-900/50 dark:from-rose-950/35 dark:to-rose-950/55 dark:text-rose-200',
  }

  const sizes: Record<IconButtonSize, string> = {
    sm: 'h-8 w-8',
    md: 'h-9 w-9',
  }

  return (
    <button
      {...rest}
      class={cn(base, variants[variant()], sizes[size()], local.class)}
      disabled={local.disabled}
      aria-label={local.label}
      title={(local.title as string | undefined) ?? local.label}
    >
      {local.children}
    </button>
  )
}
