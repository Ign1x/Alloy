import type { JSX } from 'solid-js'
import { createEffect, onCleanup, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { cn } from './cn'

function focusableElements(root: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
  ].join(',')
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => {
    if (el.hasAttribute('disabled')) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    const style = window.getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none'
  })
}

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

export type ModalProps = {
  open: boolean
  title: string
  description?: string
  size?: ModalSize
  children: JSX.Element
  footer?: JSX.Element
  onClose: () => void
  closeOnOverlayClick?: boolean
  closeOnEsc?: boolean
  initialFocus?: () => HTMLElement | null | undefined
}

export function Modal(props: ModalProps) {
  let dialogEl: HTMLDivElement | undefined
  let previousActive: HTMLElement | null = null

  const size = () => props.size ?? 'md'
  const sizes: Record<ModalSize, string> = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }

  function onKeyDown(ev: KeyboardEvent) {
    if (!props.open) return
    if (ev.key === 'Escape' && (props.closeOnEsc ?? true)) {
      ev.preventDefault()
      props.onClose()
      return
    }
    if (ev.key !== 'Tab') return
    const root = dialogEl
    if (!root) return
    const focusables = focusableElements(root)
    if (!focusables.length) {
      ev.preventDefault()
      root.focus()
      return
    }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement as HTMLElement | null
    if (ev.shiftKey) {
      if (active === first || !root.contains(active)) {
        ev.preventDefault()
        last.focus()
      }
      return
    }
    if (active === last) {
      ev.preventDefault()
      first.focus()
    }
  }

  createEffect(() => {
    if (!props.open) return
    previousActive = (document.activeElement as HTMLElement | null) ?? null
    const onKey = (ev: KeyboardEvent) => onKeyDown(ev)
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  createEffect(() => {
    if (props.open) return
    if (!previousActive) return
    try {
      previousActive.focus()
    } catch {
      // ignore
    } finally {
      previousActive = null
    }
  })

  onMount(() => {
    // Prevent body scroll while modal is open.
    const original = document.body.style.overflow
    createEffect(() => {
      if (!props.open) return
      document.body.style.overflow = 'hidden'
      onCleanup(() => {
        document.body.style.overflow = original
      })
    })
  })

  createEffect(() => {
    if (!props.open) return
    queueMicrotask(() => {
      const requested = props.initialFocus?.() ?? null
      if (requested) {
        requested.focus()
        return
      }
      const root = dialogEl
      if (!root) return
      const first = focusableElements(root)[0]
      ;(first ?? root).focus()
    })
  })

  return (
    <Show when={props.open}>
      <Portal>
        <div class="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <div
            class="absolute inset-0 bg-slate-900/30 backdrop-blur-sm dark:bg-slate-950/70"
            onClick={() => {
              if (props.closeOnOverlayClick ?? true) props.onClose()
            }}
          />
          <div
            ref={(el) => (dialogEl = el)}
            class={cn(
              'relative w-full overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-2xl backdrop-blur dark:border-slate-800 dark:bg-slate-950/90',
              sizes[size()],
            )}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
          >
            <div class="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div class="text-base font-semibold text-slate-900 dark:text-slate-100">{props.title}</div>
              <Show when={props.description}>
                <div class="mt-1 text-[12px] text-slate-600 dark:text-slate-300">{props.description}</div>
              </Show>
            </div>
            <div class="max-h-[80vh] overflow-auto px-5 py-4">{props.children}</div>
            <Show when={props.footer}>
              <div class="border-t border-slate-200 px-5 py-4 dark:border-slate-800">{props.footer}</div>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  )
}

