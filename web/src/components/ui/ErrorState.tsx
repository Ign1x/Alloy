import type { JSX } from 'solid-js'
import { createSignal, Show } from 'solid-js'
import type { I18nTranslate } from '../../app/i18n'
import { isAlloyApiError } from '../../rspc'
import { Button } from './Button'
import { IconButton } from './IconButton'
import { cn } from './cn'

export type ErrorStateProps = {
  t?: I18nTranslate
  title?: string
  error: unknown
  hint?: string
  onRetry?: () => void
  actions?: JSX.Element
  class?: string
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.stack || `${err.name}: ${err.message}`
  try {
    return JSON.stringify(err, null, 2)
  } catch {
    return String(err)
  }
}

async function safeCopy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // ignore
  }
}

export function ErrorState(props: ErrorStateProps) {
  const [expanded, setExpanded] = createSignal(false)
  const t = (key: string, params?: Record<string, string | number>) =>
    props.t ? props.t(key as never, params as never) : key
  const api = () => (isAlloyApiError(props.error) ? props.error : null)
  const title = () => props.title ?? t('errors.somethingWentWrong')
  const message = () => api()?.data.message ?? (props.error instanceof Error ? props.error.message : t('errors.unknownError'))
  const requestId = () => api()?.data.request_id ?? ''

  return (
    <div
      class={cn('feedback-card border-rose-200/95 bg-rose-50/94 text-rose-950 dark:border-rose-900/45 dark:bg-rose-950/28 dark:text-rose-100', props.class)}
      role="alert"
      aria-live="assertive"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm font-semibold tracking-[0.01em] text-rose-900 dark:text-rose-100">{title()}</div>
          <div class="mt-0.5 text-[12px] text-rose-800/90 dark:text-rose-200/90">{message()}</div>
          <Show when={props.hint}>
            <div class="mt-1 text-[11px] text-rose-700/85 dark:text-rose-200/80">{props.hint}</div>
          </Show>
        </div>
        <div class="feedback-actions">
          <Show when={props.onRetry}>
            <Button size="xs" variant="secondary" aria-keyshortcuts="R" onClick={() => props.onRetry?.()}>
              {t('banner.retry')}
            </Button>
          </Show>
          <Show when={props.actions}>{props.actions}</Show>
          <Button
            size="xs"
            variant="secondary"
            onClick={() => safeCopy(api() ? JSON.stringify(api()!.data, null, 2) : stringifyError(props.error))}
          >
            {t('errors.copyDetails')}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded() ? t('errors.hideDetails') : t('errors.showDetails')}
          </Button>
        </div>
      </div>

      <Show when={requestId()}>
        <div class="mt-2 flex items-center justify-between gap-2 rounded-lg border border-rose-300/45 bg-rose-100/45 px-2.5 py-2 dark:border-rose-900/40 dark:bg-rose-950/25">
          <div class="min-w-0 truncate whitespace-nowrap font-mono text-[11px] text-rose-800/70 dark:text-rose-200/70">
            {t('common.requestId')} {requestId()}
          </div>
          <IconButton size="sm" variant="secondary" class="shrink-0" label={t('eventCenter.copyRequestId')} onClick={() => safeCopy(requestId())}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
              <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
              <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
            </svg>
          </IconButton>
        </div>
      </Show>

      <Show when={expanded()}>
        <pre class="mt-3 max-h-56 overflow-auto rounded-xl bg-slate-950 px-3 py-2 text-[11px] leading-relaxed text-slate-100">
          {stringifyError(props.error)}
        </pre>
      </Show>
    </div>
  )
}
