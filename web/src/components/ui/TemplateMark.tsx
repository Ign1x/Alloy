import type { JSX } from 'solid-js'
import { createMemo } from 'solid-js'
import { cn } from './cn'

export type TemplateMarkProps = {
  templateId: string
  class?: string
  title?: string
}

type TemplateMarkInfo = {
  label: string
  class: string
  icon: JSX.Element
}

function templateKind(templateId: string): string {
  const i = templateId.indexOf(':')
  return i >= 0 ? templateId.slice(0, i) : templateId
}

function titleCase(s: string): string {
  if (!s) return 'Template'
  return s.slice(0, 1).toUpperCase() + s.slice(1)
}

function CubeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5" aria-hidden="true">
      <path d="M10 2 3 6l7 4 7-4-7-4z" opacity="0.9" />
      <path d="M3 6v8l7 4v-8L3 6z" opacity="0.7" />
      <path d="M17 6v8l-7 4v-8l7-4z" opacity="0.5" />
    </svg>
  )
}

function TreeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5" aria-hidden="true">
      <path d="M10 2 4.5 10H7L5 14h3v4h4v-4h3l-2-4h2.5L10 2z" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5" aria-hidden="true">
      <path d="M11.25 2.5a.75.75 0 0 1 .75.75 6 6 0 0 0 6 6 .75.75 0 0 1 .53 1.28A7.5 7.5 0 1 1 10.22 1.22a.75.75 0 0 1 1.03.53Z" />
    </svg>
  )
}

function GamepadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5" aria-hidden="true">
      <path d="M6.5 7.5h7c1.8 0 3.25 1.46 3.25 3.25v.2c0 2.73-1.52 5.05-3.4 5.05-.96 0-1.83-.71-2.38-1.72l-.33-.62a.75.75 0 0 0-.66-.41H9.02a.75.75 0 0 0-.66.41l-.33.62c-.55 1.01-1.42 1.72-2.38 1.72-1.88 0-3.4-2.32-3.4-5.05v-.2C2.25 8.96 3.7 7.5 5.5 7.5h1Z" />
      <path d="M6.75 10.5H6v-.75a.75.75 0 0 0-1.5 0v.75h-.75a.75.75 0 0 0 0 1.5h.75v.75a.75.75 0 0 0 1.5 0V12h.75a.75.75 0 0 0 0-1.5Z" />
      <path d="M13.25 12a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
      <path d="M15 10.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
    </svg>
  )
}

export function TemplateMark(props: TemplateMarkProps) {
  const meta = createMemo<TemplateMarkInfo>(() => {
    const kind = templateKind(props.templateId)
    if (kind === 'minecraft') {
      return {
        label: 'Minecraft',
        class:
          'border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200',
        icon: <CubeIcon />,
      }
    }
    if (kind === 'terraria') {
      return {
        label: 'Terraria',
        class:
          'border-sky-200 bg-sky-50/80 text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-200',
        icon: <TreeIcon />,
      }
    }
    if (kind === 'demo') {
      return {
        label: 'Demo',
        class: 'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200',
        icon: <MoonIcon />,
      }
    }
    return {
      label: titleCase(kind),
      class:
        'border-slate-200 bg-white/70 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200',
      icon: <GamepadIcon />,
    }
  })

  const title = () => props.title ?? meta().label

  return (
    <span
      role="img"
      aria-label={title()}
      title={title()}
      class={cn('inline-flex h-9 w-9 flex-none items-center justify-center rounded-xl border shadow-sm dark:shadow-none', meta().class, props.class)}
    >
      {meta().icon}
    </span>
  )
}
