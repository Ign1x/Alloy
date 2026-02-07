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
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" class="h-5 w-5" aria-hidden="true">
      <path d="M10 2.25 3.5 5.75 10 9.25l6.5-3.5L10 2.25Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" />
      <path d="M3.5 5.75v8L10 17.25v-8L3.5 5.75Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" />
      <path d="M16.5 5.75v8L10 17.25v-8l6.5-3.5Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" />
      <path d="M10 9.25v8" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
    </svg>
  )
}

function TreeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" class="h-5 w-5" aria-hidden="true">
      <path d="M10 2.2 5.05 8.5H7.5L5.9 11.8h2.35L6.95 15h6.1l-1.3-3.2h2.35L12.5 8.5h2.45L10 2.2Z" fill="currentColor" />
      <path d="M10 15v2.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  )
}

function DstWilsonIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" class="h-5 w-5" aria-hidden="true">
      <path
        d="M10 1.7 11.4 3.8l2.3-.8-.4 2.3 2.3-.4-1 2 1.9.6-1.5 1.2 1.2 1.5-2-.1.2 1.9-1.8-.7-.8 2-1.4-1.2-1.4 1.2-.8-2-1.8.7.2-1.9-2 .1 1.2-1.5-1.5-1.2 1.9-.6-1-2 2.3.4-.4-2.3 2.3.8L10 1.7Z"
        stroke="currentColor"
        stroke-width="1.05"
        stroke-linejoin="round"
      />
      <path d="M10 5.9c2.1 0 3.7 1.6 3.7 3.6 0 2-1.6 3.6-3.7 3.6s-3.7-1.6-3.7-3.6c0-2 1.6-3.6 3.7-3.6Z" stroke="currentColor" stroke-width="1.05" />
      <circle cx="8.7" cy="8.9" r="0.42" fill="currentColor" />
      <circle cx="11.3" cy="8.9" r="0.42" fill="currentColor" />
      <path d="M9.25 10.45c.2.26.45.4.75.4.3 0 .55-.14.75-.4" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" />
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
    if (kind === 'dst') {
      return {
        label: "Don't Starve Together",
        class:
          'border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200',
        icon: <DstWilsonIcon />,
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
