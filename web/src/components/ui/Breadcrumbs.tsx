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
      <ol class="flex flex-wrap items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300">
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
                    class="ring-focus motion-surface block min-w-0 truncate rounded-md px-1 py-0.5 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
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
