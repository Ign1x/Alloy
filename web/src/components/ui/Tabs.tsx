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
    <div class={cn('inline-flex items-center gap-1 rounded-2xl border border-slate-200/90 bg-white/76 p-1 shadow-sm dark:border-slate-800 dark:bg-slate-950/58 dark:shadow-none', props.class)}>
      <For each={props.options}>
        {(opt) => (
          <button
            type="button"
            class={cn(
              'ring-focus motion-surface rounded-xl px-3 py-1.5 text-xs font-semibold tracking-[0.01em]',
              opt.value === props.value
                ? 'bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-600 hover:bg-slate-100/90 dark:text-slate-300 dark:hover:bg-slate-900/70',
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
