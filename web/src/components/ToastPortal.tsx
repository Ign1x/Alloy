import { AlertTriangle, Check, Info } from 'lucide-solid'
import { For, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { safeCopy } from '../app/helpers/misc'
import { cn } from './ui/cn'

export type ToastPortalProps = {
  [key: string]: unknown
}

export default function ToastPortal(props: ToastPortalProps) {
  const { toasts, dismissToast, t: translate } = props as any

  function contextLabel(scope: string | undefined) {
    if (scope === 'instance') return translate('eventCenter.scope.instance')
    if (scope === 'node') return translate('eventCenter.scope.node')
    if (scope === 'job') return translate('eventCenter.scope.job')
    return translate('eventCenter.scope.system')
  }

  function levelIcon(scope: 'success' | 'error' | 'info') {
    if (scope === 'success') return <Check class="h-3.5 w-3.5" />
    if (scope === 'error') return <AlertTriangle class="h-3.5 w-3.5" />
    return <Info class="h-3.5 w-3.5" />
  }

  const textClass = (variant: 'info' | 'success' | 'error', role: 'title' | 'body' | 'meta') => {
    if (variant === 'success') {
      if (role === 'title') return 'text-emerald-900 dark:text-emerald-100'
      if (role === 'body') return 'text-emerald-800 dark:text-emerald-200'
      return 'text-emerald-800/80 dark:text-emerald-200/85'
    }
    if (variant === 'error') {
      if (role === 'title') return 'text-rose-900 dark:text-rose-100'
      if (role === 'body') return 'text-rose-800 dark:text-rose-200'
      return 'text-rose-800/80 dark:text-rose-200/85'
    }
    if (role === 'title') return 'text-slate-900 dark:text-slate-100'
    if (role === 'body') return 'text-slate-700 dark:text-slate-200'
    return 'text-slate-600 dark:text-slate-300'
  }

  return (
    <Portal>
      <div class="pointer-events-none fixed bottom-3 right-3 z-[var(--z-toast)] flex w-[min(92vw,24rem)] flex-col gap-2 sm:bottom-4 sm:right-4 sm:w-[360px]">
        <For each={toasts()}>
          {(toast) => (
            <div
              role={toast.variant === 'error' ? 'alert' : 'status'}
              aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
              class={`pointer-events-auto motion-enter-pop overflow-hidden rounded-2xl border bg-white/82 shadow-2xl shadow-slate-900/12 backdrop-blur-xl dark:bg-slate-950/78 ${
                toast.variant === 'success'
                  ? 'border-emerald-200/95 dark:border-emerald-900/40'
                  : toast.variant === 'error'
                    ? 'border-rose-200/95 dark:border-rose-900/40'
                    : 'border-slate-200/95 dark:border-slate-800'
              }`}
            >
                <div class="p-3">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5">
                        <span
                          class={
                            toast.variant === 'success'
                              ? 'text-emerald-700 dark:text-emerald-300'
                              : toast.variant === 'error'
                                ? 'text-rose-700 dark:text-rose-300'
                                : 'text-slate-600 dark:text-slate-300'
                          }
                        >
                          {levelIcon(toast.variant === 'success' ? 'success' : toast.variant === 'error' ? 'error' : 'info')}
                        </span>
                        <div class={cn('text-sm font-semibold tracking-[0.01em]', textClass(toast.variant, 'title'))}>
                          {toast.title}
                        </div>
                      </div>
                    <Show when={toast.context}>
                      <div class={cn('mt-1 flex items-center gap-1.5 text-[10px]', textClass(toast.variant, 'meta'))}>
                        <span class="rounded-md border border-slate-200/90 bg-white/70 px-1.5 py-0.5 font-semibold uppercase tracking-[0.12em] dark:border-slate-700 dark:bg-slate-950/65">
                          {contextLabel(toast.context?.scope)}
                        </span>
                        <Show when={toast.context?.label}>
                          <span class="truncate">{toast.context?.label}</span>
                        </Show>
                      </div>
                    </Show>
                    <Show when={toast.message}>
                      <div class={cn('mt-1 text-[12px]', textClass(toast.variant, 'body'))}>{toast.message}</div>
                    </Show>
                    <Show when={(toast.count ?? 1) > 1}>
                      <div class={cn('mt-1 text-[10px]', textClass(toast.variant, 'meta'))}>
                        {translate('eventCenter.occurrences', { count: toast.count ?? 1 })}
                      </div>
                    </Show>
                  </div>
                  <button
                    type="button"
                    class="ring-focus motion-surface rounded-lg border border-slate-200/90 bg-white/74 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-white dark:border-slate-800 dark:bg-slate-950/62 dark:text-slate-200 dark:hover:bg-slate-900/90"
                    onClick={() => dismissToast(toast.id)}
                  >
                    {translate('eventCenter.closeToast')}
                  </button>
                </div>

                <Show when={toast.requestId}>
                  <div class="mt-2 flex items-center justify-between gap-2">
                    <div class="min-w-0 truncate whitespace-nowrap font-mono text-[11px] text-slate-600 dark:text-slate-300">
                      {translate('common.requestId')} {toast.requestId}
                    </div>
                    <button type="button" class="ring-focus motion-surface shrink-0 rounded-lg border border-slate-200/90 bg-white/74 p-1.5 text-slate-700 hover:bg-white dark:border-slate-800 dark:bg-slate-950/62 dark:text-slate-200 dark:hover:bg-slate-900/90" aria-label={translate('eventCenter.copyRequestId')} title={translate('eventCenter.copyRequestId')} onClick={() => safeCopy(toast.requestId ?? '')}>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                        <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                        <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                      </svg>
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
