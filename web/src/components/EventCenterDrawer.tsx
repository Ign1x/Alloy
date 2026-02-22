import { Bell, RotateCw } from 'lucide-solid'
import { For, Show, createMemo } from 'solid-js'

import { safeCopy } from '../app/helpers/misc'
import type { I18nTranslate } from '../app/i18n'
import type { Toast } from '../app/types'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Drawer } from './ui/Drawer'

type EventCenterDrawerProps = {
  open: boolean
  onClose: () => void
  events: () => Toast[]
  markAllEventsRead: () => void
  clearEvents: () => void
  runRetryAction: (key: string) => Promise<boolean>
  pushToast: (variant: 'info' | 'success' | 'error', title: string, message?: string, requestId?: string) => void
  t: I18nTranslate
}

function contextLabel(t: I18nTranslate, item: Toast): string {
  if (item.context?.scope === 'instance') return t('eventCenter.scope.instance')
  if (item.context?.scope === 'node') return t('eventCenter.scope.node')
  if (item.context?.scope === 'job') return t('eventCenter.scope.job')
  return t('eventCenter.scope.system')
}

function contextText(t: I18nTranslate, item: Toast): string {
  const label = item.context?.label?.trim() ?? ''
  if (label) return label
  const id = item.context?.id?.trim() ?? ''
  if (id) return id
  return t('eventCenter.noContext')
}

function variantBadge(item: Toast): 'neutral' | 'success' | 'warning' | 'danger' {
  if (item.variant === 'error') return 'danger'
  if (item.variant === 'success') return 'success'
  return 'neutral'
}

function variantLabel(t: I18nTranslate, item: Toast): string {
  if (item.variant === 'error') return t('eventCenter.level.error')
  if (item.variant === 'success') return t('eventCenter.level.success')
  return t('eventCenter.level.info')
}

export default function EventCenterDrawer(props: EventCenterDrawerProps) {
  const unreadCount = createMemo(() => props.events().filter((event) => !event.isRead).length)

  const onClose = () => {
    props.markAllEventsRead()
    props.onClose()
  }

  async function retry(item: Toast) {
    const retryKey = item.retry?.key
    if (!retryKey) return
    const ok = await props.runRetryAction(retryKey)
    if (ok) {
      props.pushToast('success', props.t('eventCenter.retrySubmitted'), item.title)
      return
    }
    props.pushToast('error', props.t('eventCenter.retryFailed'), item.title)
  }

  return (
    <Drawer
      open={props.open}
      onClose={onClose}
      side="right"
      title={props.t('eventCenter.title')}
      closeLabel={props.t('common.close')}
      closeAriaLabel={props.t('common.close')}
    >
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
          <div>
            <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">{props.t('eventCenter.title')}</div>
            <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{props.t('eventCenter.desc')}</div>
          </div>
          <Badge variant={unreadCount() > 0 ? 'warning' : 'neutral'}>
            {props.t('eventCenter.unreadCount', { count: unreadCount() })}
          </Badge>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => props.markAllEventsRead()}>
            {props.t('eventCenter.markAllRead')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => props.clearEvents()}>
            {props.t('eventCenter.clearAll')}
          </Button>
        </div>

        <Show
          when={props.events().length > 0}
          fallback={
            <div class="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center dark:border-slate-700 dark:bg-slate-900/20">
              <div class="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                <Bell class="h-5 w-5" />
              </div>
              <div class="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">{props.t('eventCenter.emptyTitle')}</div>
              <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">{props.t('eventCenter.emptyDesc')}</div>
            </div>
          }
        >
          <div class="space-y-2">
            <For each={props.events()}>
              {(item) => (
                <div class={`rounded-xl border p-3 ${item.isRead ? 'border-slate-200 bg-white/70 dark:border-slate-800 dark:bg-slate-950/60' : 'border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/20'}`}>
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-1.5">
                        <Badge variant={variantBadge(item)}>{variantLabel(props.t, item)}</Badge>
                        <Badge variant="neutral">{contextLabel(props.t, item)}</Badge>
                        <Show when={(item.count ?? 1) > 1}>
                          <Badge variant="warning">{props.t('eventCenter.occurrences', { count: item.count ?? 1 })}</Badge>
                        </Show>
                      </div>
                      <div class="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{item.title}</div>
                      <Show when={item.message}>
                        <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">{item.message}</div>
                      </Show>
                      <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{contextText(props.t, item)}</div>
                    </div>
                  </div>

                  <div class="mt-2 flex flex-wrap items-center gap-2">
                    <Show when={item.requestId}>
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => {
                          void safeCopy(item.requestId ?? '')
                          props.pushToast('success', props.t('eventCenter.requestIdCopied'), item.requestId)
                        }}
                      >
                        {props.t('eventCenter.copyRequestId')}
                      </Button>
                    </Show>

                    <Show when={item.retry?.key}>
                      <Button size="xs" variant="secondary" leftIcon={<RotateCw class="h-3.5 w-3.5" />} onClick={() => void retry(item)}>
                        {props.t('eventCenter.retry')}
                      </Button>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Drawer>
  )
}
