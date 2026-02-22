import type { JSX } from 'solid-js'
import { Show } from 'solid-js'

import { shouldOfferSettingsAction, suggestedErrorActions } from '../../app/helpers/errorActions'
import type { I18nTranslate } from '../../app/i18n'
import { Banner } from './Banner'
import { Button } from './Button'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { Skeleton } from './Skeleton'
import { cn } from './cn'

type DataBoundaryStale = {
  show: boolean
  title: string
  message?: string
  onRetry?: () => void
}

export type DataBoundaryProps = {
  t?: I18nTranslate
  loading: boolean
  error?: unknown | null
  errorTitle?: string
  hasData?: boolean
  empty: boolean
  emptyTitle?: string
  emptyDescription?: string
  emptyActions?: JSX.Element
  loadingLines?: number
  loadingClass?: string
  loadingHint?: string
  onRetry?: () => void
  stale?: DataBoundaryStale
  onOpenSettings?: () => void
  settingsCtaLabel?: string
  class?: string
  children: JSX.Element
}

export function shouldShowSettingsCta(error: unknown, hasHandler: boolean): boolean {
  return hasHandler && shouldOfferSettingsAction(error)
}

export function DataBoundary(props: DataBoundaryProps) {
  const translate = (key: string, fallback: string) => (props.t ? props.t(key as never) : fallback)
  const hasData = () => Boolean(props.hasData)
  const showFatalError = () => Boolean(props.error) && !hasData()
  const showLoading = () => props.loading && !hasData() && !showFatalError()
  const actionTypes = () => suggestedErrorActions(props.error, Boolean(props.onRetry), Boolean(props.onOpenSettings))
  const showSettingsCta = () => actionTypes().includes('open-settings')
  const showRetryCta = () => actionTypes().includes('retry')

  return (
    <div class={cn('space-y-3', props.class)}>
      <Show when={props.stale?.show}>
        <Banner
          variant="warning"
          title={props.stale?.title ?? translate('downloads.refreshFailedTitle', 'Refresh failed')}
          message={props.stale?.message}
          actions={
            props.stale?.onRetry ? (
              <Button size="xs" variant="secondary" onClick={() => props.stale?.onRetry?.()}>
                {translate('banner.retry', 'Retry')}
              </Button>
            ) : undefined
          }
        />
      </Show>

      <Show when={showLoading()} fallback={
        <Show when={showFatalError()} fallback={
          <Show when={props.empty} fallback={props.children}>
            <EmptyState title={props.emptyTitle ?? translate('common.noData', 'No data')} description={props.emptyDescription} actions={props.emptyActions} />
          </Show>
        }>
          <div class="space-y-3">
            <ErrorState t={props.t} error={props.error} title={props.errorTitle} onRetry={showRetryCta() ? props.onRetry : undefined} />
            <Show when={showSettingsCta()}>
              <div class="flex items-center justify-end gap-2">
                <Button size="xs" variant="secondary" onClick={() => props.onOpenSettings?.()}>
                  {props.settingsCtaLabel ?? translate('downloads.openSettings', 'Open settings')}
                </Button>
              </div>
            </Show>
          </div>
        </Show>
      }>
        <div class={cn('rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40', props.loadingClass)}>
          <Skeleton lines={Math.max(1, props.loadingLines ?? 6)} />
          <Show when={props.loadingHint}>
            <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{props.loadingHint}</div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
