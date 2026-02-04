import { For } from 'solid-js'
import { cn } from './cn'

export type TabOption<T extends string> = {
  value: T
  label: string
}

export type TabsProps<T extends string> = {
  value: T
  options: TabOption<T>[]
  onChange: (value: T) => void
  class?: string
}

export function Tabs<T extends string>(props: TabsProps<T>) {
  return (
    <div class={cn('inline-flex items-center gap-1 rounded-2xl border border-slate-200 bg-white/60 p-1 dark:border-slate-800 dark:bg-slate-950/40', props.class)}>
      <For each={props.options}>
        {(opt) => (
          <button
            type="button"
            class={cn(
              'rounded-xl px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950',
              opt.value === props.value
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900/60',
            )}
            onClick={() => props.onChange(opt.value)}
          >
            {opt.label}
          </button>
        )}
      </For>
    </div>
  )
}
