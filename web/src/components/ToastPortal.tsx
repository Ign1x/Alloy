import { For, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { safeCopy } from '../app/helpers/misc'

export type ToastPortalProps = {
  [key: string]: unknown
}

export default function ToastPortal(props: ToastPortalProps) {
  const { toasts, setToasts } = props as any

  return (
    <Portal>
      <div class="pointer-events-none fixed bottom-4 right-4 z-[9999] flex w-[360px] flex-col gap-2">
        <For each={toasts()}>
          {(t) => (
            <div
              class={`pointer-events-auto overflow-hidden rounded-2xl border bg-white/80 shadow-2xl shadow-slate-900/10 backdrop-blur transition-all duration-150 animate-in fade-in zoom-in-95 dark:bg-slate-950/80 ${
                t.variant === 'success'
                  ? 'border-emerald-200 dark:border-emerald-900/40'
                  : t.variant === 'error'
                    ? 'border-rose-200 dark:border-rose-900/40'
                    : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div class="p-3">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div
                      class={`text-sm font-semibold ${
                        t.variant === 'success'
                          ? 'text-emerald-900 dark:text-emerald-200'
                          : t.variant === 'error'
                            ? 'text-rose-900 dark:text-rose-200'
                            : 'text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {t.title}
                    </div>
                    <Show when={t.message}>
                      <div class="mt-1 text-[12px] text-slate-600 dark:text-slate-300">{t.message}</div>
                    </Show>
                  </div>
                  <button
                    type="button"
                    class="rounded-lg border border-slate-200 bg-white/70 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900"
                    onClick={() => setToasts((prev: any[]) => prev.filter((x) => x.id !== t.id))}
                  >
                    Close
                  </button>
                </div>

                <Show when={t.requestId}>
                  <div class="mt-2 flex items-center justify-between gap-2">
                    <div class="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">req {t.requestId}</div>
                    <button
                      type="button"
                      class="rounded-lg border border-slate-200 bg-white/70 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900"
                      onClick={() => safeCopy(t.requestId ?? '')}
                    >
                      COPY
                    </button>
                  </div>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    </Portal>
  )
}
