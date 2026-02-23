import type { JSX } from 'solid-js'
import { For, Show, createEffect, createMemo, createSignal, createUniqueId } from 'solid-js'
import { cn } from './ui/cn'

export type DropdownOption = {
  value: string
  label: string
  meta?: string
}

export type DropdownProps = {
  label: string
  value: string
  options: DropdownOption[]
  disabled?: boolean
  placeholder?: string
  leftIcon?: JSX.Element
  class?: string
  buttonClass?: string
  ariaLabel?: string
  title?: string
  onChange: (value: string) => void
}

export function Dropdown(props: DropdownProps) {
  const [open, setOpen] = createSignal(false)
  const [activeIndex, setActiveIndex] = createSignal(-1)
  let rootEl: HTMLDivElement | undefined
  let buttonEl: HTMLButtonElement | undefined
  let listboxEl: HTMLDivElement | undefined

  const listboxId = `dropdown-listbox-${createUniqueId()}`

  const selected = createMemo(() => props.options.find((o) => o.value === props.value) || null)
  const selectedIndex = createMemo(() => props.options.findIndex((o) => o.value === props.value))

  const normalizeIndex = (index: number) => {
    if (props.options.length <= 0) return -1
    if (index < 0) return 0
    if (index >= props.options.length) return props.options.length - 1
    return index
  }

  const openMenu = (focusListbox: boolean) => {
    if (props.disabled) return
    setOpen(true)
    setActiveIndex(normalizeIndex(selectedIndex() >= 0 ? selectedIndex() : 0))
    if (focusListbox) {
      queueMicrotask(() => listboxEl?.focus())
    }
  }

  const closeMenu = (focusButton: boolean) => {
    setOpen(false)
    setActiveIndex(-1)
    if (focusButton) queueMicrotask(() => buttonEl?.focus())
  }

  const choose = (value: string) => {
    props.onChange(value)
    closeMenu(true)
  }

  const moveActive = (next: number) => {
    if (!open()) {
      openMenu(false)
      return
    }
    setActiveIndex(normalizeIndex(next))
  }

  createEffect(() => {
    if (!open()) return
    setActiveIndex(normalizeIndex(selectedIndex() >= 0 ? selectedIndex() : 0))
    const onDoc = (ev: MouseEvent) => {
      const t = ev.target as Node | null
      if (!t) return
      if (rootEl && rootEl.contains(t)) return
      closeMenu(false)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') closeMenu(true)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  })

  createEffect(() => {
    if (!open()) return
    const index = activeIndex()
    if (index < 0) return
    const el = rootEl?.querySelector<HTMLElement>(`[data-dropdown-option-index="${index}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  })

  return (
    <div class={cn('relative', props.class)} ref={(el) => (rootEl = el)}>
      <Show when={props.label.length > 0}>
        <div class="text-sm font-semibold text-slate-700 dark:text-slate-300">{props.label}</div>
      </Show>
      <button
        type="button"
        ref={(el) => (buttonEl = el)}
        class={cn(
          `${props.label.length > 0 ? 'mt-1' : ''} ring-focus motion-surface motion-pop flex w-full items-center justify-between gap-3 rounded-xl border border-slate-300/95 bg-white/82 px-3 py-2 text-sm font-medium text-slate-900 shadow-sm backdrop-blur-sm hover:-translate-y-0.5 hover:bg-white hover:shadow-md active:translate-y-0 active:scale-[0.99] focus-visible:border-amber-400/60 focus-visible:ring-amber-500/25 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:shadow-none dark:border-slate-800 dark:bg-slate-950/62 dark:text-slate-200 dark:hover:bg-slate-950/85 dark:focus-visible:border-amber-500/55 dark:focus-visible:ring-amber-500/25`,
          props.buttonClass,
        )}
        disabled={props.disabled}
        aria-expanded={open()}
        aria-controls={open() ? listboxId : undefined}
        aria-haspopup="listbox"
        aria-label={props.ariaLabel ?? (props.label.length > 0 ? props.label : undefined)}
        title={props.title}
        onClick={() => {
          if (open()) {
            closeMenu(false)
            return
          }
          openMenu(false)
        }}
        onKeyDown={(ev) => {
          if (props.disabled) return
          if (ev.key === 'ArrowDown') {
            ev.preventDefault()
            moveActive((open() ? activeIndex() : selectedIndex()) + 1)
            if (!open()) openMenu(true)
            return
          }
          if (ev.key === 'ArrowUp') {
            ev.preventDefault()
            if (!open()) {
              openMenu(true)
              setActiveIndex(normalizeIndex((selectedIndex() >= 0 ? selectedIndex() : props.options.length) - 1))
              return
            }
            moveActive(activeIndex() - 1)
            return
          }
          if (ev.key === 'Enter' || ev.key === ' ') {
            if (!open()) {
              ev.preventDefault()
              openMenu(true)
            }
            return
          }
          if (ev.key === 'Escape' && open()) {
            ev.preventDefault()
            closeMenu(false)
          }
        }}
      >
        <div class="flex min-w-0 items-center gap-2">
          <Show when={props.leftIcon}>
            <div class="shrink-0 text-slate-500 dark:text-slate-400">{props.leftIcon}</div>
          </Show>
          <Show
            when={selected()}
            fallback={<span class="text-slate-500 dark:text-slate-400">{props.placeholder ?? 'Select...'}</span>}
          >
            <div class="truncate">{selected()!.label}</div>
          </Show>
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          class="h-5 w-5 shrink-0 text-slate-500"
        >
          <path
            fill-rule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
            clip-rule="evenodd"
          />
        </svg>
      </button>

      <Show when={open()}>
        <div class="surface-glass motion-enter-pop absolute left-0 right-0 z-50 mt-3 overflow-hidden shadow-2xl shadow-slate-900/12">
          <div
            id={listboxId}
            ref={(el) => (listboxEl = el)}
            class="max-h-64 overflow-auto p-1"
            role="listbox"
            tabIndex={-1}
            aria-activedescendant={activeIndex() >= 0 ? `${listboxId}-option-${activeIndex()}` : undefined}
            onKeyDown={(ev) => {
              if (ev.key === 'ArrowDown') {
                ev.preventDefault()
                moveActive(activeIndex() + 1)
                return
              }
              if (ev.key === 'ArrowUp') {
                ev.preventDefault()
                moveActive(activeIndex() - 1)
                return
              }
              if (ev.key === 'Home') {
                ev.preventDefault()
                moveActive(0)
                return
              }
              if (ev.key === 'End') {
                ev.preventDefault()
                moveActive(props.options.length - 1)
                return
              }
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault()
                const index = activeIndex()
                if (index >= 0 && props.options[index]) choose(props.options[index].value)
                return
              }
              if (ev.key === 'Escape') {
                ev.preventDefault()
                closeMenu(true)
              }
            }}
          >
            <Show when={props.options.length > 0} fallback={<div class="px-3 py-2 text-[12px] text-slate-500 dark:text-slate-400">-</div>}>
              <For each={props.options}>
                {(opt, index) => (
                  <button
                    type="button"
                    id={`${listboxId}-option-${index()}`}
                    data-dropdown-option-index={index()}
                    role="option"
                    aria-selected={opt.value === props.value}
                    class={`ring-focus motion-surface flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium ${
                      opt.value === props.value
                        ? 'bg-amber-500/12 text-slate-900 ring-1 ring-inset ring-amber-500/30 dark:bg-amber-500/18 dark:text-slate-100 dark:ring-amber-500/40'
                        : index() === activeIndex()
                          ? 'bg-slate-100/88 text-slate-900 dark:bg-slate-900/70 dark:text-slate-100'
                          : 'text-slate-700 hover:bg-slate-100/88 dark:text-slate-200 dark:hover:bg-slate-900/70'
                    }`}
                    onMouseEnter={() => setActiveIndex(index())}
                    onClick={() => choose(opt.value)}
                  >
                    <div class="min-w-0">
                      <div class="truncate">{opt.label}</div>
                      <Show when={opt.meta}>
                        <div class="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">{opt.meta}</div>
                      </Show>
                    </div>
                    <Show when={opt.value === props.value}>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        class="h-5 w-5 text-amber-600 dark:text-amber-400"
                      >
                        <path
                          fill-rule="evenodd"
                          d="M16.704 5.29a1 1 0 010 1.42l-7.25 7.25a1 1 0 01-1.42 0l-3.25-3.25a1 1 0 011.42-1.42l2.54 2.54 6.54-6.54a1 1 0 011.42 0z"
                          clip-rule="evenodd"
                        />
                      </svg>
                    </Show>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
