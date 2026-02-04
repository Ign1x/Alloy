import type { JSX } from 'solid-js'
import { cn } from './cn'

export type TooltipProps = {
  content: JSX.Element
  children: JSX.Element
  class?: string
}

export function Tooltip(props: TooltipProps) {
  return (
    <span class={cn('relative inline-flex group', props.class)}>
      {props.children}
      <span class="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-max max-w-[240px] -translate-x-1/2 rounded-xl border border-slate-200 bg-white/90 px-2.5 py-1.5 text-[11px] leading-snug text-slate-700 shadow-2xl shadow-slate-900/10 opacity-0 translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0 dark:border-slate-800 dark:bg-slate-950/90 dark:text-slate-200">
        {props.content}
      </span>
    </span>
  )
}

