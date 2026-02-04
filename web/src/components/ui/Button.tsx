import type { JSX } from 'solid-js'
import { Show, splitProps } from 'solid-js'
import { cn } from './cn'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'xs' | 'sm' | 'md'

export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  leftIcon?: JSX.Element
  rightIcon?: JSX.Element
}

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, [
    'variant',
    'size',
    'loading',
    'leftIcon',
    'rightIcon',
    'class',
    'disabled',
    'children',
  ])

  const variant = () => local.variant ?? 'secondary'
  const size = () => local.size ?? 'sm'
  const disabled = () => Boolean(local.disabled || local.loading)

  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl border text-sm font-medium shadow-sm transition-all duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:shadow-none dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950'

  const variants: Record<ButtonVariant, string> = {
    primary:
      'border-amber-500/20 bg-amber-500/10 text-amber-900 hover:bg-amber-500/15 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-100 dark:hover:bg-amber-500/20',
    secondary:
      'border-slate-200 bg-white/70 text-slate-800 hover:bg-white hover:shadow dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900',
    danger:
      'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 hover:shadow dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200 dark:hover:bg-rose-950/30',
    ghost:
      'border-transparent bg-transparent text-slate-700 shadow-none hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900/60',
  }

  const sizes: Record<ButtonSize, string> = {
    xs: 'px-2.5 py-1.5 text-xs',
    sm: 'px-3 py-2 text-xs',
    md: 'px-3.5 py-2.5 text-sm',
  }

  return (
    <button
      {...rest}
      class={cn(base, variants[variant()], sizes[size()], local.class)}
      disabled={disabled()}
      aria-busy={local.loading ? 'true' : undefined}
    >
      <Show when={local.loading} fallback={local.leftIcon}>
        <Spinner class="h-4 w-4" />
      </Show>
      <Show when={local.children}>{local.children}</Show>
      <Show when={local.rightIcon}>{local.rightIcon}</Show>
    </button>
  )
}
