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
    <div class={cn('surface-card motion-enter rounded-2xl border border-dashed p-6 text-center', props.class)}>
      <div class="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white/75 text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300 dark:shadow-none">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5" aria-hidden="true">
          <path d="M3 5.75A2.75 2.75 0 015.75 3h8.5A2.75 2.75 0 0117 5.75v8.5A2.75 2.75 0 0114.25 17h-8.5A2.75 2.75 0 013 14.25v-8.5z" opacity="0.3" />
          <path d="M6.75 8a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zm0 3a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5z" />
        </svg>
      </div>
      <div class="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{props.title}</div>
      <Show when={props.description}>
        <div class="mx-auto mt-1 max-w-[34rem] text-[12px] text-slate-600 dark:text-slate-300">{props.description}</div>
      </Show>
      <Show when={props.actions}>
        <div class="mt-4 flex flex-wrap items-center justify-center gap-2">{props.actions}</div>
      </Show>
    </div>
  )
}
