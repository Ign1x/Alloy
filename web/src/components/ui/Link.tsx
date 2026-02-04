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
    'inline-flex items-center gap-1 underline underline-offset-2 decoration-transparent hover:decoration-current transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950'

  const variants: Record<LinkVariant, string> = {
    default: 'text-amber-700 hover:text-amber-600 dark:text-amber-300 dark:hover:text-amber-200',
    muted: 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100',
    danger: 'text-rose-700 hover:text-rose-600 dark:text-rose-300 dark:hover:text-rose-200',
  }

  return <a {...rest} class={cn(base, variants[variant()], local.class)} />
}

