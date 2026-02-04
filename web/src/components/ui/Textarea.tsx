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
    'w-full rounded-xl border bg-white/80 px-3 py-2 text-sm text-slate-900 shadow-sm backdrop-blur-sm transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-950/60 dark:text-slate-200 dark:focus-visible:ring-offset-slate-950'

  const ok =
    'border-slate-300 hover:bg-white focus-visible:border-amber-500/40 focus-visible:ring-amber-500/20 dark:border-slate-800 dark:hover:bg-slate-950/80 dark:focus-visible:border-amber-500/40 dark:focus-visible:ring-amber-500/20'

  const bad =
    'border-rose-300 hover:bg-white focus-visible:border-rose-500/50 focus-visible:ring-rose-500/20 dark:border-rose-900/40 dark:hover:bg-slate-950/80 dark:focus-visible:border-rose-500/50 dark:focus-visible:ring-rose-500/20'

  return (
    <textarea {...rest} class={cn(base, invalid() ? bad : ok, 'min-h-24 resize-y', local.class)} aria-invalid={invalid() ? 'true' : undefined} />
  )
}
