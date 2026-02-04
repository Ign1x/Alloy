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
    'inline-flex items-center justify-center rounded-xl border shadow-sm transition-all duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:shadow-none dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950'

  const variants: Record<IconButtonVariant, string> = {
    secondary:
      'border-slate-200 bg-white/70 text-slate-700 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900',
    ghost:
      'border-transparent bg-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900/60',
    danger:
      'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200 dark:hover:bg-rose-950/30',
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
