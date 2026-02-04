import type { JSX } from 'solid-js'
import { For, Show } from 'solid-js'
import { cn } from './cn'

export type BreadcrumbItem = {
  label: JSX.Element
  title?: string
  onClick?: () => void
}

export type BreadcrumbsProps = {
  items: BreadcrumbItem[]
  class?: string
}

export function Breadcrumbs(props: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" class={cn('min-w-0', props.class)}>
      <ol class="flex flex-wrap items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
        <For each={props.items}>
          {(item, idx) => (
            <>
              <Show when={idx() > 0}>
                <li aria-hidden="true" class="select-none px-1 text-slate-300 dark:text-slate-700">
                  /
                </li>
              </Show>
              <li class="min-w-0">
                <Show
                  when={item.onClick}
                  fallback={
                    <span class="block min-w-0 truncate text-slate-600 dark:text-slate-300" title={item.title}>
                      {item.label}
                    </span>
                  }
                >
                  <button
                    type="button"
                    class="block min-w-0 truncate rounded-md px-1 py-0.5 text-slate-600 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:text-slate-300 dark:hover:text-slate-100 dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950"
                    onClick={() => item.onClick?.()}
                    title={item.title}
                  >
                    {item.label}
                  </button>
                </Show>
              </li>
            </>
          )}
        </For>
      </ol>
    </nav>
  )
}

