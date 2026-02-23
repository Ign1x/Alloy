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
    'ring-focus motion-surface relative z-0 w-full rounded-xl border bg-white/82 py-2 text-sm font-medium text-slate-900 shadow-sm backdrop-blur-sm disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-950/62 dark:text-slate-200'

  const padding = () => {
    const left = local.leftIcon ? 'pl-9' : 'pl-3'
    const right = local.rightIcon ? 'pr-9' : 'pr-3'
    return `${left} ${right}`
  }

  const ok =
    'border-slate-300/95 hover:bg-white focus-visible:border-amber-400/60 focus-visible:ring-amber-500/25 dark:border-slate-800 dark:hover:bg-slate-950/85 dark:focus-visible:border-amber-500/55 dark:focus-visible:ring-amber-500/25'

  const bad =
    'border-rose-300/95 hover:bg-white focus-visible:border-rose-500/60 focus-visible:ring-rose-500/25 dark:border-rose-900/50 dark:hover:bg-slate-950/85 dark:focus-visible:border-rose-500/60 dark:focus-visible:ring-rose-500/25'

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
          <div class="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-slate-500 dark:text-slate-400">
            {local.leftIcon}
          </div>
        </Show>
        {input}
        <Show when={local.rightIcon}>
          <div class="absolute right-3 top-1/2 z-10 -translate-y-1/2 text-slate-500 dark:text-slate-400">
            {local.rightIcon}
          </div>
        </Show>
      </div>
    </Show>
  )
}
