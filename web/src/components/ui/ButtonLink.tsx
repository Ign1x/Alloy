import type { JSX } from 'solid-js'
import { Show, splitProps } from 'solid-js'
import { cn } from './cn'
import { Spinner } from './Spinner'
import type { ButtonSize, ButtonVariant } from './Button'

export type ButtonLinkProps = JSX.AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  leftIcon?: JSX.Element
  rightIcon?: JSX.Element
  disabled?: boolean
}

export function ButtonLink(props: ButtonLinkProps) {
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
    'ring-focus motion-surface motion-pop inline-flex items-center justify-center gap-2 rounded-xl border text-sm font-semibold tracking-[0.01em] shadow-sm hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0 dark:shadow-none'

  const variants: Record<ButtonVariant, string> = {
    primary:
      'border-amber-300/60 bg-gradient-to-b from-amber-200/85 via-amber-300/85 to-amber-400/90 text-amber-950 shadow-amber-900/15 hover:from-amber-200 hover:via-amber-300 hover:to-amber-500 dark:border-amber-500/45 dark:from-amber-500/55 dark:via-amber-500/65 dark:to-amber-600/70 dark:text-amber-100',
    secondary:
      'border-slate-200/90 bg-white/78 text-slate-800 hover:bg-white dark:border-slate-800 dark:bg-slate-950/62 dark:text-slate-200 dark:hover:bg-slate-900/90',
    danger:
      'border-rose-300/70 bg-gradient-to-b from-rose-100 to-rose-200/85 text-rose-900 shadow-rose-900/15 hover:from-rose-100 hover:to-rose-200 dark:border-rose-900/50 dark:from-rose-950/35 dark:to-rose-950/55 dark:text-rose-200',
    ghost:
      'border-transparent bg-transparent text-slate-700 shadow-none hover:bg-slate-100/85 hover:shadow-none dark:text-slate-200 dark:hover:bg-slate-900/70',
  }

  const sizes: Record<ButtonSize, string> = {
    xs: 'h-8 px-2.5 text-xs',
    sm: 'h-9 px-3 text-xs',
    md: 'h-10 px-3.5 text-sm',
  }

  return (
    <a
      {...rest}
      class={cn(base, variants[variant()], sizes[size()], disabled() ? 'pointer-events-none opacity-50' : '', local.class)}
      aria-busy={local.loading ? 'true' : undefined}
      aria-disabled={disabled() ? 'true' : undefined}
      tabIndex={disabled() ? -1 : rest.tabIndex}
    >
      <Show when={local.loading} fallback={local.leftIcon}>
        <Spinner class="h-4 w-4" />
      </Show>
      <Show when={local.children}>{local.children}</Show>
      <Show when={local.rightIcon}>{local.rightIcon}</Show>
    </a>
  )
}
