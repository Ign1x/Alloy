import type { JSX } from 'solid-js'
import { createEffect, createUniqueId, onCleanup, onMount, Show } from 'solid-js'
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

function lockDocumentScroll() {
  const body = document.body
  const html = document.documentElement
  const scrollY = window.scrollY || window.pageYOffset || 0

  const prev = {
    bodyOverflow: body.style.overflow,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyWidth: body.style.width,
    bodyTouchAction: body.style.touchAction,
    htmlOverflow: html.style.overflow,
    htmlOverscrollBehaviorY: html.style.overscrollBehaviorY,
  }

  body.style.overflow = 'hidden'
  body.style.position = 'fixed'
  body.style.top = `-${scrollY}px`
  body.style.width = '100%'
  body.style.touchAction = 'none'
  html.style.overflow = 'hidden'
  html.style.overscrollBehaviorY = 'none'

  return () => {
    body.style.overflow = prev.bodyOverflow
    body.style.position = prev.bodyPosition
    body.style.top = prev.bodyTop
    body.style.width = prev.bodyWidth
    body.style.touchAction = prev.bodyTouchAction
    html.style.overflow = prev.htmlOverflow
    html.style.overscrollBehaviorY = prev.htmlOverscrollBehaviorY
    window.scrollTo(0, scrollY)
  }
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
  closeLabel?: string
  closeAriaLabel?: string
}

export function Drawer(props: DrawerProps) {
  let panelEl: HTMLDivElement | undefined
  let previousActive: HTMLElement | null = null
  const titleId = `drawer-title-${createUniqueId()}`

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
    createEffect(() => {
      if (!props.open) return
      const unlock = lockDocumentScroll()
      onCleanup(unlock)
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
        <div class="fixed inset-0 z-[var(--z-overlay)]">
          <div
            class="absolute inset-0 bg-slate-900/32 backdrop-blur-md dark:bg-slate-950/74"
            onClick={() => {
              if (props.closeOnOverlayClick ?? true) props.onClose()
            }}
          />
          <div
            ref={(el) => (panelEl = el)}
            class={cn(
              'surface-glass motion-enter-pop absolute inset-y-0 w-[min(420px,100dvw-0.5rem)] overflow-hidden border shadow-[var(--app-shadow-xl)] dark:shadow-none',
              side() === 'left' ? 'left-0 rounded-r-2xl' : 'right-0 rounded-l-2xl',
              props.class,
            )}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
          >
            <div class="flex h-full flex-col">
              <div class="flex items-center justify-between gap-3 border-b border-slate-200/90 px-4 py-3 sm:px-5 sm:py-4 dark:border-slate-800">
                <div id={titleId} class="text-sm font-semibold leading-tight tracking-tight text-slate-900 break-words dark:text-slate-100 sm:text-base">
                  {props.title}
                </div>
                <button
                  type="button"
                  class="ring-focus motion-surface motion-pop rounded-xl border border-slate-200/90 bg-white/78 px-2.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:-translate-y-0.5 hover:bg-white hover:shadow-md dark:border-slate-800 dark:bg-slate-950/62 dark:text-slate-200 dark:hover:bg-slate-900/90"
                  onClick={props.onClose}
                  aria-label={props.closeAriaLabel ?? props.closeLabel ?? 'Close'}
                >
                  {props.closeLabel ?? 'Close'}
                </button>
              </div>
              <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5 sm:py-4">{props.children}</div>
              <Show when={props.footer}>
                <div class="border-t border-slate-200/90 px-4 py-3 sm:px-5 sm:py-4 dark:border-slate-800">{props.footer}</div>
              </Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
