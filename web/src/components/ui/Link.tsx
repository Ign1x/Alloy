import type { JSX } from 'solid-js'
import { splitProps } from 'solid-js'
import { cn } from './cn'

export type LinkVariant = 'default' | 'muted' | 'danger'

export type LinkProps = JSX.AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: LinkVariant
}

export function Link(props: LinkProps) {
  const [local, rest] = splitProps(props, ['variant', 'class'])
  const variant = () => local.variant ?? 'default'

  const base =
    'ring-focus inline-flex items-center gap-1 font-medium underline decoration-1 underline-offset-2 transition-colors hover:decoration-current'

  const variants: Record<LinkVariant, string> = {
    default: 'text-amber-700 decoration-amber-700/50 hover:text-amber-600 hover:decoration-amber-600 dark:text-amber-300 dark:decoration-amber-300/60 dark:hover:text-amber-200 dark:hover:decoration-amber-200',
    muted: 'text-slate-700 decoration-slate-600/40 hover:text-slate-900 hover:decoration-slate-900 dark:text-slate-300 dark:decoration-slate-300/50 dark:hover:text-slate-100 dark:hover:decoration-slate-100',
    danger: 'text-rose-700 decoration-rose-700/55 hover:text-rose-600 hover:decoration-rose-600 dark:text-rose-300 dark:decoration-rose-300/60 dark:hover:text-rose-200 dark:hover:decoration-rose-200',
  }

  return <a {...rest} class={cn(base, variants[variant()], local.class)} />
}
