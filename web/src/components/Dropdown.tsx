import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'

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
  onChange: (value: string) => void
}

export function Dropdown(props: DropdownProps) {
  const [open, setOpen] = createSignal(false)
  let rootEl: HTMLDivElement | undefined

  const selected = createMemo(() => props.options.find((o) => o.value === props.value) || null)

  createEffect(() => {
    if (!open()) return
    const onDoc = (ev: MouseEvent) => {
      const t = ev.target as Node | null
      if (!t) return
      if (rootEl && rootEl.contains(t)) return
      setOpen(false)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  })

  return (
    <div class="relative" ref={(el) => (rootEl = el)}>
      <Show when={props.label.length > 0}>
        <div class="text-sm text-slate-700 dark:text-slate-300">{props.label}</div>
      </Show>
      <button
        type="button"
        class={`${props.label.length > 0 ? 'mt-1' : ''} flex w-full items-center justify-between gap-3 rounded-xl border border-slate-300 bg-white/80 px-3 py-2 text-sm text-slate-900 shadow-sm backdrop-blur-sm transition-all duration-150 hover:bg-white hover:shadow active:scale-[0.99] focus-visible:border-amber-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/20 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-950/80 dark:focus-visible:border-amber-500/40 dark:focus-visible:ring-amber-500/20 dark:focus-visible:ring-offset-slate-950`}
        disabled={props.disabled}
        aria-expanded={open()}
        onClick={() => setOpen((v) => !v)}
      >
        <div class="min-w-0">
          <Show
            when={selected()}
            fallback={<span class="text-slate-500 dark:text-slate-400">{props.placeholder ?? 'Select...'}</span>}
          >
            <div class="truncate">{selected()!.label}</div>
          </Show>
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5 text-slate-500">
          <path
            fill-rule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
            clip-rule="evenodd"
          />
        </svg>
      </button>

      <Show when={open()}>
        <div class="absolute left-0 right-0 z-50 mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-2xl shadow-slate-900/10 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
          <div class="max-h-64 overflow-auto p-1">
            <For each={props.options}>
              {(opt) => (
                <button
                  type="button"
                  class={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-all hover:bg-slate-100 active:scale-[0.99] dark:hover:bg-slate-900/50 ${
                    opt.value === props.value ? 'bg-slate-100 dark:bg-slate-900/50' : ''
                  }`}
                  onClick={() => {
                    props.onChange(opt.value)
                    setOpen(false)
                  }}
                >
                  <div class="min-w-0">
                    <div class="truncate text-slate-900 dark:text-slate-100">{opt.label}</div>
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
          </div>
        </div>
      </Show>
    </div>
  )
}
