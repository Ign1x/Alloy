import type { JSX } from 'solid-js'
import { cn } from './cn'

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger'

export type BadgeProps = {
  variant?: BadgeVariant
  class?: string
  title?: string
  children: JSX.Element
}

export function Badge(props: BadgeProps) {
  const variant = () => props.variant ?? 'neutral'
  const variants: Record<BadgeVariant, string> = {
    neutral: 'border-slate-200/95 bg-white/78 text-slate-700 dark:border-slate-800 dark:bg-slate-950/58 dark:text-slate-200',
    success:
      'border-emerald-200/95 bg-emerald-50/92 text-emerald-900 dark:border-emerald-900/45 dark:bg-emerald-950/28 dark:text-emerald-200',
    warning:
      'border-amber-200/95 bg-amber-50/94 text-amber-900 dark:border-amber-900/45 dark:bg-amber-950/28 dark:text-amber-200',
    danger:
      'border-rose-200/95 bg-rose-50/94 text-rose-900 dark:border-rose-900/45 dark:bg-rose-950/28 dark:text-rose-200',
  }

  return (
    <span
      class={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-[0.01em]',
        variants[variant()],
        props.class,
      )}
      title={props.title}
    >
      {props.children}
    </span>
  )
}
