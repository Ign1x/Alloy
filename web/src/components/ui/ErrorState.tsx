import { createSignal, Show } from 'solid-js'
import { isAlloyApiError } from '../../rspc'
import { Button } from './Button'
import { cn } from './cn'

export type ErrorStateProps = {
  title?: string
  error: unknown
  onRetry?: () => void
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
  const api = () => (isAlloyApiError(props.error) ? props.error : null)
  const title = () => props.title ?? 'Something went wrong'
  const message = () => api()?.data.message ?? (props.error instanceof Error ? props.error.message : 'Unknown error')
  const requestId = () => api()?.data.request_id ?? ''

  return (
    <div class={cn('rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/40 dark:bg-rose-950/20', props.class)}>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm font-semibold text-rose-900 dark:text-rose-100">{title()}</div>
          <div class="mt-1 text-[12px] text-rose-800/90 dark:text-rose-200/90">{message()}</div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Show when={props.onRetry}>
            <Button size="xs" variant="secondary" onClick={() => props.onRetry?.()}>
              Retry
            </Button>
          </Show>
          <Button
            size="xs"
            variant="secondary"
            onClick={() => safeCopy(api() ? JSON.stringify(api()!.data, null, 2) : stringifyError(props.error))}
          >
            Copy details
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded() ? 'Hide' : 'Details'}
          </Button>
        </div>
      </div>

      <Show when={requestId()}>
        <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div class="truncate font-mono text-[11px] text-rose-800/70 dark:text-rose-200/70">req {requestId()}</div>
          <Button size="xs" variant="secondary" onClick={() => safeCopy(requestId())}>
            Copy request-id
          </Button>
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
