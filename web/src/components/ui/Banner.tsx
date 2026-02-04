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
    info: 'border-slate-200 bg-white/70 text-slate-900 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-100',
    warning:
      'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100',
    danger:
      'border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-100',
  }

  return (
    <div class={cn('flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3', variants[variant()], props.class)}>
      <div class="min-w-0">
        <div class="text-sm font-semibold">{props.title}</div>
        <Show when={props.message}>
          <div class="mt-0.5 text-[12px] text-slate-600 dark:text-slate-300">{props.message}</div>
        </Show>
      </div>
      <Show when={props.actions}>
        <div class="flex flex-wrap items-center gap-2">{props.actions}</div>
      </Show>
    </div>
  )
}

