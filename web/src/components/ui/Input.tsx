import type { JSX } from 'solid-js'
import { Show, splitProps } from 'solid-js'
import { cn } from './cn'

export type InputProps = JSX.InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean
  leftIcon?: JSX.Element
  rightIcon?: JSX.Element
  containerClass?: string
}

export function Input(props: InputProps) {
  const [local, rest] = splitProps(props, ['invalid', 'leftIcon', 'rightIcon', 'containerClass', 'class'])
  const invalid = () => Boolean(local.invalid)
  const withIcons = () => Boolean(local.leftIcon || local.rightIcon)

  const base =
    'w-full rounded-xl border bg-white/80 py-2 text-sm text-slate-900 shadow-sm backdrop-blur-sm transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-950/60 dark:text-slate-200 dark:focus-visible:ring-offset-slate-950'

  const padding = () => {
    const left = local.leftIcon ? 'pl-9' : 'pl-3'
    const right = local.rightIcon ? 'pr-9' : 'pr-3'
    return `${left} ${right}`
  }

  const ok =
    'border-slate-300 hover:bg-white focus-visible:border-amber-500/40 focus-visible:ring-amber-500/20 dark:border-slate-800 dark:hover:bg-slate-950/80 dark:focus-visible:border-amber-500/40 dark:focus-visible:ring-amber-500/20'

  const bad =
    'border-rose-300 hover:bg-white focus-visible:border-rose-500/50 focus-visible:ring-rose-500/20 dark:border-rose-900/40 dark:hover:bg-slate-950/80 dark:focus-visible:border-rose-500/50 dark:focus-visible:ring-rose-500/20'

  const input = (
    <input
      {...rest}
      class={cn(base, padding(), invalid() ? bad : ok, local.class)}
      aria-invalid={invalid() ? 'true' : undefined}
    />
  )

  return (
    <Show when={withIcons()} fallback={input}>
      <div class={cn('relative w-full', local.containerClass)}>
        <Show when={local.leftIcon}>
          <div class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400">
            {local.leftIcon}
          </div>
        </Show>
        {input}
        <Show when={local.rightIcon}>
          <div class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400">
            {local.rightIcon}
          </div>
        </Show>
      </div>
    </Show>
  )
}
