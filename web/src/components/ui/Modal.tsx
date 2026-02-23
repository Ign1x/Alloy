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

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

export type ModalProps = {
  open: boolean
  title: string | JSX.Element
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
  const titleId = `modal-title-${createUniqueId()}`
  const descId = `modal-desc-${createUniqueId()}`

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
    createEffect(() => {
      if (!props.open) return
      const unlock = lockDocumentScroll()
      onCleanup(unlock)
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
        <div class="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center p-2 sm:p-4">
          <div
            class="absolute inset-0 bg-slate-900/32 backdrop-blur-md dark:bg-slate-950/74"
            onClick={() => {
              if (props.closeOnOverlayClick ?? true) props.onClose()
            }}
          />
          <div
            ref={(el) => (dialogEl = el)}
            class={cn(
              'surface-glass motion-enter-pop relative w-full max-w-[min(100dvw-1rem,100%)] overflow-hidden border shadow-[var(--app-shadow-xl)] dark:shadow-none',
              sizes[size()],
            )}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={props.description ? descId : undefined}
            tabIndex={-1}
          >
            <div class="border-b border-slate-200/90 px-4 py-3 sm:px-5 sm:py-4 dark:border-slate-800">
              <div id={titleId} class="text-sm font-semibold leading-tight tracking-tight text-slate-900 break-words dark:text-slate-100 sm:text-base">
                {props.title}
              </div>
              <Show when={props.description}>
                <div id={descId} class="mt-1 text-[12px] text-slate-600 dark:text-slate-300">
                  {props.description}
                </div>
              </Show>
            </div>
            <div class="max-h-[min(82dvh,80vh)] overflow-y-auto overscroll-contain px-4 py-3 sm:px-5 sm:py-4">{props.children}</div>
            <Show when={props.footer}>
              <div class="border-t border-slate-200/90 px-4 py-3 sm:px-5 sm:py-4 dark:border-slate-800">{props.footer}</div>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
