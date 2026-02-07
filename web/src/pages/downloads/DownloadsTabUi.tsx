import { Show, type JSX } from 'solid-js'

import type { DownloadCenterView } from '../../app/types'

export const SURFACE =
  'rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:shadow-none'

export function NavItem(props: {
  value: DownloadCenterView
  current: () => DownloadCenterView
  icon?: JSX.Element
  label: string
  meta?: string
  right?: JSX.Element
  onSelect: (value: DownloadCenterView) => void
}) {
  const active = () => props.current() === props.value
  return (
    <button
      type="button"
      class={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950 ${
        active()
          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900/40'
      }`}
      onClick={() => props.onSelect(props.value)}
    >
      <div class="flex min-w-0 items-center gap-3">
        <div class={`flex h-6 w-6 flex-none items-center justify-center ${active() ? 'text-white dark:text-slate-900' : 'text-slate-500 dark:text-slate-400'}`}>
          {props.icon}
        </div>
        <div class="min-w-0">
          <div class="truncate font-medium">{props.label}</div>
          <Show when={props.meta}>
            <div class={`mt-0.5 truncate text-[11px] ${active() ? 'text-white/75 dark:text-slate-700' : 'text-slate-500 dark:text-slate-400'}`}>
              {props.meta}
            </div>
          </Show>
        </div>
      </div>
      <Show when={props.right}>
        <div class={active() ? 'text-white/90 dark:text-slate-700' : 'text-slate-500 dark:text-slate-400'}>{props.right}</div>
      </Show>
    </button>
  )
}

export function StatusPill(props: { ok: boolean; children: JSX.Element }) {
  return (
    <span
      class={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${
        props.ok
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200'
          : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200'
      }`}
    >
      {props.children}
    </span>
  )
}

export function Section(props: { title: string; description?: string; right?: JSX.Element; children: JSX.Element }) {
  return (
    <section class={SURFACE}>
      <div class="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">{props.title}</div>
            <Show when={props.description}>
              <div class="mt-1 text-[12px] text-slate-600 dark:text-slate-400">{props.description}</div>
            </Show>
          </div>
          <Show when={props.right}>
            <div class="flex flex-wrap items-center gap-2">{props.right}</div>
          </Show>
        </div>
      </div>
      <div class="p-4">{props.children}</div>
    </section>
  )
}
