import type { JSX } from 'solid-js'
import { Show } from 'solid-js'
import { cn } from './cn'

export type BannerVariant = 'info' | 'warning' | 'danger'

export type BannerProps = {
  variant?: BannerVariant
  title: string
  message?: string
  actions?: JSX.Element
  class?: string
}

export function Banner(props: BannerProps) {
  const variant = () => props.variant ?? 'info'
  const variants: Record<BannerVariant, string> = {
    info: 'border-slate-200/95 bg-white/78 text-slate-900 dark:border-slate-800 dark:bg-slate-950/62 dark:text-slate-100',
    warning:
      'border-amber-200/95 bg-amber-50/94 text-amber-950 dark:border-amber-900/45 dark:bg-amber-950/28 dark:text-amber-100',
    danger:
      'border-rose-200/95 bg-rose-50/94 text-rose-950 dark:border-rose-900/45 dark:bg-rose-950/28 dark:text-rose-100',
  }

  return (
    <div
      class={cn('feedback-card motion-enter slide-up-soft flex flex-wrap items-center justify-between gap-3 shadow-sm backdrop-blur dark:shadow-none', variants[variant()], props.class)}
      role={variant() === 'danger' ? 'alert' : 'status'}
      aria-live={variant() === 'danger' ? 'assertive' : 'polite'}
    >
      <div class="min-w-0">
        <div class="text-sm font-semibold tracking-[0.01em]">{props.title}</div>
        <Show when={props.message}>
          <div class="mt-0.5 text-[12px] text-current/82">{props.message}</div>
        </Show>
      </div>
      <Show when={props.actions}>
        <div class="feedback-actions">{props.actions}</div>
      </Show>
    </div>
  )
}
