import { createSignal } from 'solid-js'

import { getLastRspcRequestId, isAlloyApiError } from '../../rspc'
import type { I18nTranslate } from '../i18n'
import type { Toast, ToastPushOptions, ToastVariant } from '../types'

const MAX_VISIBLE_TOASTS = 4
const MAX_EVENT_ITEMS = 120
const TOAST_AUTO_CLOSE_MS = 6500
const EVENT_AGGREGATE_WINDOW_MS = 45_000

function makeToastId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return Math.random().toString(36).slice(2)
  }
}

function friendlyErrorMessage(err: unknown, t: I18nTranslate): string {
  const raw = err instanceof Error ? err.message : t('errors.unknownError')
  const lower = raw.toLowerCase()
  if (lower.includes('504 gateway time-out') || lower.includes('504 gateway timeout')) {
    return t('toast.friendly.gatewayTimeout')
  }
  if (lower.includes('502 bad gateway') || lower.includes('http 502')) {
    return t('toast.friendly.badGateway')
  }
  if (lower.includes('<html') && (lower.includes('bad gateway') || lower.includes('nginx'))) {
    return t('toast.friendly.htmlErrorPage')
  }
  if (lower.includes('node is currently unreachable') || lower.includes('node tunnel disconnected')) {
    return t('toast.friendly.nodeReconnecting')
  }
  return raw
}

export function useToastBus(t: I18nTranslate) {
  const [toasts, setToasts] = createSignal<Toast[]>([])
  const [events, setEvents] = createSignal<Toast[]>([])
  const toastTimerById = new Map<string, number>()
  const retryActionByKey = new Map<string, () => void | Promise<void>>()

  function normalizeGroupKey(
    variant: ToastVariant,
    title: string,
    message: string | undefined,
    requestId: string | undefined,
    context: ToastPushOptions['context'],
    groupKey: string | undefined,
  ): string {
    if (groupKey && groupKey.trim()) return groupKey.trim()
    return JSON.stringify({
      variant,
      title,
      message: message ?? '',
      requestId: requestId ?? '',
      context,
    })
  }

  function clearToastTimer(id: string) {
    const timer = toastTimerById.get(id)
    if (timer == null) return
    window.clearTimeout(timer)
    toastTimerById.delete(id)
  }

  function dismissToast(id: string) {
    clearToastTimer(id)
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }

  function scheduleAutoClose(id: string) {
    clearToastTimer(id)
    const timer = window.setTimeout(() => {
      toastTimerById.delete(id)
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, TOAST_AUTO_CLOSE_MS)
    toastTimerById.set(id, timer)
  }

  function upsertEvent(nextToast: Toast) {
    setEvents((prev) => {
      const idx = prev.findIndex(
        (event) => event.groupKey === nextToast.groupKey && nextToast.updatedAtUnixMs - event.updatedAtUnixMs <= EVENT_AGGREGATE_WINDOW_MS,
      )

      if (idx >= 0) {
        const out = [...prev]
        const existing = out[idx]!
        const merged: Toast = {
          ...existing,
          variant: nextToast.variant === 'error' || existing.variant === 'error' ? 'error' : nextToast.variant,
          title: nextToast.title,
          message: nextToast.message,
          requestId: nextToast.requestId || existing.requestId,
          context: nextToast.context ?? existing.context,
          sticky: nextToast.sticky ?? existing.sticky,
          retry: nextToast.retry ?? existing.retry,
          updatedAtUnixMs: nextToast.updatedAtUnixMs,
          count: existing.count + 1,
          isRead: false,
        }
        out[idx] = merged
        out.splice(idx, 1)
        return [merged, ...out]
      }

      return [{ ...nextToast, isRead: false }, ...prev].slice(0, MAX_EVENT_ITEMS)
    })
  }

  function pushToast(variant: ToastVariant, title: string, message?: string, requestId?: string, options?: ToastPushOptions) {
    const now = Date.now()
    const context = options?.context ?? { scope: 'system', label: title }
    const groupKey = normalizeGroupKey(variant, title, message, requestId, context, options?.groupKey)

    let visibleToastId = ''
    let shouldAutoClose = true
    let eventItem: Toast | null = null

    setToasts((prev) => {
      const idx = prev.findIndex((toast) => toast.groupKey === groupKey)
      if (idx >= 0) {
        const existing = prev[idx]!
        const sticky = options?.sticky ?? existing.sticky
        const merged: Toast = {
          ...existing,
          title,
          message,
          requestId,
          context,
          sticky,
          retry: options?.retry ?? existing.retry,
          updatedAtUnixMs: now,
          count: existing.count + 1,
        }
        visibleToastId = merged.id
        shouldAutoClose = !sticky
        eventItem = merged
        return [...prev.slice(0, idx), ...prev.slice(idx + 1), merged].slice(-MAX_VISIBLE_TOASTS)
      }

      const id = makeToastId()
      const toast: Toast = {
        id,
        variant,
        title,
        message,
        requestId,
        createdAtUnixMs: now,
        updatedAtUnixMs: now,
        count: 1,
        groupKey,
        context,
        sticky: options?.sticky,
        retry: options?.retry,
      }
      visibleToastId = id
      shouldAutoClose = !Boolean(options?.sticky)
      eventItem = toast
      return [...prev, toast].slice(-MAX_VISIBLE_TOASTS)
    })

    if (eventItem) upsertEvent(eventItem)

    if (options?.retry?.key && options.onRetry) {
      retryActionByKey.set(options.retry.key, options.onRetry)
    }

    if (!visibleToastId) return
    if (shouldAutoClose) scheduleAutoClose(visibleToastId)
    else clearToastTimer(visibleToastId)
  }

  function toastError(title: string, err: unknown, options?: ToastPushOptions) {
    if (isAlloyApiError(err)) {
      pushToast('error', title, err.data.message, err.data.request_id, options)
      return
    }
    pushToast('error', title, friendlyErrorMessage(err, t), undefined, options)
  }

  function toastSuccess(title: string, message?: string, requestId?: string, options?: ToastPushOptions) {
    pushToast('success', title, message, requestId, options)
  }

  function toastSuccessFromRspc(
    key: string,
    title: string,
    message?: string,
    options?: ToastPushOptions,
  ) {
    const requestId = getLastRspcRequestId('mutation', key)
    pushToast('success', title, message, requestId, options)
  }

  function clearEvents() {
    setEvents([])
  }

  function runRetryAction(key: string): Promise<boolean> {
    const action = retryActionByKey.get(key)
    if (!action) return Promise.resolve(false)
    return Promise.resolve(action())
      .then(() => true)
      .catch(() => false)
  }

  function markAllEventsRead() {
    setEvents((prev) => prev.map((event) => (event.isRead ? event : { ...event, isRead: true })))
  }

  return {
    toasts,
    setToasts,
    dismissToast,
    events,
    clearEvents,
    markAllEventsRead,
    runRetryAction,
    pushToast,
    toastError,
    toastSuccess,
    toastSuccessFromRspc,
    friendlyErrorMessage: (err: unknown) => friendlyErrorMessage(err, t),
  }
}
