import { createSignal } from 'solid-js'

import { isAlloyApiError } from '../../rspc'
import type { Toast, ToastVariant } from '../types'

function makeToastId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return Math.random().toString(36).slice(2)
  }
}

function friendlyErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : 'unknown error'
  const lower = raw.toLowerCase()
  if (lower.includes('504 gateway time-out') || lower.includes('504 gateway timeout')) {
    return 'Gateway timed out, but backend may still be downloading. Open Downloads, warm files first, then retry.'
  }
  if (lower.includes('502 bad gateway') || lower.includes('http 502')) {
    return 'Bad Gateway (502). The web proxy could not reach the backend. Refresh the page and retry.'
  }
  if (lower.includes('<html') && (lower.includes('bad gateway') || lower.includes('nginx'))) {
    return 'The server returned an HTML error page. Refresh the page and retry.'
  }
  return raw
}

export function useToastBus() {
  const [toasts, setToasts] = createSignal<Toast[]>([])

  function pushToast(variant: ToastVariant, title: string, message?: string, requestId?: string) {
    const id = makeToastId()

    setToasts((prev) => [...prev, { id, variant, title, message, requestId }].slice(-4))
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, 6500)
  }

  function toastError(title: string, err: unknown) {
    if (isAlloyApiError(err)) {
      pushToast('error', title, err.data.message, err.data.request_id)
      return
    }
    pushToast('error', title, friendlyErrorMessage(err))
  }

  return {
    toasts,
    setToasts,
    pushToast,
    toastError,
    friendlyErrorMessage,
  }
}
