import type { JSX } from 'solid-js'
import { Show } from 'solid-js'
import { cn } from './cn'

export type EmptyStateProps = {
  title: string
  description?: string
  actions?: JSX.Element
  class?: string
}

export function EmptyState(props: EmptyStateProps) {
  return (
    <div class={cn('rounded-2xl border border-dashed border-slate-200 bg-white/40 p-6 text-center dark:border-slate-800 dark:bg-slate-950/20', props.class)}>
      <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">{props.title}</div>
      <Show when={props.description}>
        <div class="mt-1 text-[12px] text-slate-600 dark:text-slate-300">{props.description}</div>
      </Show>
      <Show when={props.actions}>
        <div class="mt-4 flex flex-wrap items-center justify-center gap-2">{props.actions}</div>
      </Show>
    </div>
  )
}

