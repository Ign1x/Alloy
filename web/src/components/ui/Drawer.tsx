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

export type DrawerSide = 'left' | 'right'

export type DrawerProps = {
  open: boolean
  title: string
  children: JSX.Element
  footer?: JSX.Element
  onClose: () => void
  side?: DrawerSide
  class?: string
  closeOnOverlayClick?: boolean
  closeOnEsc?: boolean
}

export function Drawer(props: DrawerProps) {
  let panelEl: HTMLDivElement | undefined
  let previousActive: HTMLElement | null = null

  const side = () => props.side ?? 'left'

  function onKeyDown(ev: KeyboardEvent) {
    if (!props.open) return
    if (ev.key === 'Escape' && (props.closeOnEsc ?? true)) {
      ev.preventDefault()
      props.onClose()
      return
    }
    if (ev.key !== 'Tab') return
    const root = panelEl
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
      const root = panelEl
      if (!root) return
      const first = focusableElements(root)[0]
      ;(first ?? root).focus()
    })
  })

  return (
    <Show when={props.open}>
      <Portal>
        <div class="fixed inset-0 z-[10000]">
          <div
            class="absolute inset-0 bg-slate-900/30 backdrop-blur-sm dark:bg-slate-950/70"
            onClick={() => {
              if (props.closeOnOverlayClick ?? true) props.onClose()
            }}
          />
          <div
            ref={(el) => (panelEl = el)}
            class={cn(
              'absolute inset-y-0 w-[min(360px,90vw)] overflow-hidden border border-slate-200 bg-white/95 shadow-2xl backdrop-blur dark:border-slate-800 dark:bg-slate-950/90',
              side() === 'left' ? 'left-0 rounded-r-2xl' : 'right-0 rounded-l-2xl',
              props.class,
            )}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
          >
            <div class="flex h-full flex-col">
              <div class="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                <div class="text-base font-semibold text-slate-900 dark:text-slate-100">{props.title}</div>
                <button
                  type="button"
                  class="rounded-xl border border-slate-200 bg-white/70 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900"
                  onClick={props.onClose}
                  aria-label="Close"
                >
                  Close
                </button>
              </div>
              <div class="min-h-0 flex-1 overflow-auto px-5 py-4">{props.children}</div>
              <Show when={props.footer}>
                <div class="border-t border-slate-200 px-5 py-4 dark:border-slate-800">{props.footer}</div>
              </Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}

