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
  loadingFallback?: JSX.Element
  onRetry?: () => void
  stale?: DataBoundaryStale
  onOpenSettings?: () => void
  settingsCtaLabel?: string
  stateMinHeightClass?: string
  class?: string
  children: JSX.Element
}

export function shouldShowSettingsCta(error: unknown, hasHandler: boolean): boolean {
  return hasHandler && shouldOfferSettingsAction(error)
}

export function DataBoundary(props: DataBoundaryProps) {
  const translate = (key: string, fallback: string) => {
    if (!props.t) return fallback
    const localized = props.t(key as never)
    return typeof localized === 'string' && localized.trim().length > 0 ? localized : fallback
  }
  const hasData = () => Boolean(props.hasData)
  const showFatalError = () => Boolean(props.error) && !hasData()
  const showLoading = () => props.loading && !hasData() && !showFatalError()
  const actionTypes = () => suggestedErrorActions(props.error, Boolean(props.onRetry), Boolean(props.onOpenSettings))
  const showSettingsCta = () => actionTypes().includes('open-settings')
  const showRetryCta = () => actionTypes().includes('retry')
  const showStale = () => Boolean(props.stale?.show) && hasData() && !showFatalError()

  const errorHint = () => {
    if (showRetryCta() && showSettingsCta()) {
      return translate(
        'errors.nextStepRetryAndSettings',
        'Retry first. If it still fails, open settings and verify configuration.',
      )
    }
    if (showRetryCta()) {
      return translate('errors.nextStepRetry', 'Retry now. If it still fails, copy details and check diagnostics.')
    }
    if (showSettingsCta()) {
      return translate('errors.nextStepOpenSettings', 'Open settings to verify configuration and try again.')
    }
    return translate('errors.nextStepCopyDetails', 'Copy details and request id, then check diagnostics.')
  }

  const emptyActions = () => props.emptyActions

  return (
    <div class={cn('feedback-stack', props.class)}>
      <Show when={showStale()}>
        <Banner
          variant="warning"
          title={props.stale?.title ?? translate('downloads.refreshFailedTitle', 'Refresh failed')}
          message={props.stale?.message}
          actions={
            props.stale?.onRetry ? (
              <Button size="xs" variant="secondary" aria-keyshortcuts="R" onClick={() => props.stale?.onRetry?.()}>
                {translate('banner.retry', 'Retry')}
              </Button>
            ) : undefined
          }
        />
      </Show>

      <Show when={showLoading()}>
        <div class={cn('min-h-[10rem]', props.stateMinHeightClass)}>
          <Show
            when={props.loadingFallback}
            fallback={
              <div class={cn('surface-card rounded-xl p-3', props.loadingClass)}>
                <Skeleton lines={Math.max(1, props.loadingLines ?? 6)} />
                <Show when={props.loadingHint}>
                  <div class="mt-2 text-caption">{props.loadingHint}</div>
                </Show>
              </div>
            }
          >
            {props.loadingFallback}
          </Show>
        </div>
      </Show>

      <Show when={!showLoading() && showFatalError()}>
        <div class={cn('min-h-[10rem]', props.stateMinHeightClass)}>
          <ErrorState
            t={props.t}
            error={props.error}
            title={props.errorTitle}
            hint={errorHint()}
            onRetry={showRetryCta() ? props.onRetry : undefined}
            actions={
              showSettingsCta() ? (
                <Button size="xs" variant="secondary" onClick={() => props.onOpenSettings?.()}>
                  {props.settingsCtaLabel ?? translate('downloads.openSettings', 'Open settings')}
                </Button>
              ) : undefined
            }
          />
        </div>
      </Show>

      <Show when={!showLoading() && !showFatalError() && props.empty}>
        <div class={cn('min-h-[10rem]', props.stateMinHeightClass)}>
          <EmptyState
            title={props.emptyTitle ?? translate('common.noData', 'No data')}
            description={props.emptyDescription}
            actions={emptyActions()}
          />
        </div>
      </Show>

      <Show when={!showLoading() && !showFatalError() && !props.empty}>{props.children}</Show>
    </div>
  )
}
