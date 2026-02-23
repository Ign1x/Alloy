import type { JSX } from 'solid-js'
import { splitProps } from 'solid-js'
import { cn } from './cn'

export type TextareaProps = JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean
}

export function Textarea(props: TextareaProps) {
  const [local, rest] = splitProps(props, ['invalid', 'class'])
  const invalid = () => Boolean(local.invalid)

  const base =
    'ring-focus motion-surface w-full rounded-xl border bg-white/82 px-3 py-2 text-sm font-medium text-slate-900 shadow-sm backdrop-blur-sm disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-950/62 dark:text-slate-200'

  const ok =
    'border-slate-300/95 hover:bg-white focus-visible:border-amber-400/60 focus-visible:ring-amber-500/25 dark:border-slate-800 dark:hover:bg-slate-950/85 dark:focus-visible:border-amber-500/55 dark:focus-visible:ring-amber-500/25'

  const bad =
    'border-rose-300/95 hover:bg-white focus-visible:border-rose-500/60 focus-visible:ring-rose-500/25 dark:border-rose-900/50 dark:hover:bg-slate-950/85 dark:focus-visible:border-rose-500/60 dark:focus-visible:ring-rose-500/25'

  return (
    <textarea {...rest} class={cn(base, invalid() ? bad : ok, 'min-h-24 resize-y', local.class)} aria-invalid={invalid() ? 'true' : undefined} />
  )
}
