import type { JSX } from 'solid-js'
import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { cn } from './cn'

export type TooltipProps = {
  content: JSX.Element
  children: JSX.Element
  class?: string
}

export function Tooltip(props: TooltipProps) {
  let anchorEl: HTMLSpanElement | undefined
  let tooltipEl: HTMLDivElement | undefined
  let hideTimer: number | undefined
  let showRaf: number | undefined

  const [mounted, setMounted] = createSignal(false)
  const [active, setActive] = createSignal(false)
  const [placement, setPlacement] = createSignal<'top' | 'bottom'>('bottom')
  const [position, setPosition] = createSignal<{ left: number; top: number }>({ left: 0, top: 0 })

  function clearTimers() {
    if (hideTimer != null) {
      window.clearTimeout(hideTimer)
      hideTimer = undefined
    }
    if (showRaf != null) {
      window.cancelAnimationFrame(showRaf)
      showRaf = undefined
    }
  }

  function updatePosition() {
    const anchor = anchorEl
    const tooltip = tooltipEl
    if (!anchor || !tooltip) return

    const anchorRect = anchor.getBoundingClientRect()
    const tooltipRect = tooltip.getBoundingClientRect()

    const viewportW = window.innerWidth
    const viewportH = window.innerHeight

    const margin = 8
    const spacing = 8

    let left = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2
    left = Math.max(margin, Math.min(left, viewportW - margin - tooltipRect.width))

    let top = anchorRect.bottom + spacing
    let nextPlacement: 'top' | 'bottom' = 'bottom'

    if (top + tooltipRect.height + margin > viewportH) {
      const above = anchorRect.top - spacing - tooltipRect.height
      if (above >= margin) {
        top = above
        nextPlacement = 'top'
      } else {
        top = Math.max(margin, viewportH - margin - tooltipRect.height)
      }
    }

    setPlacement(nextPlacement)
    setPosition({ left, top })
  }

  function show() {
    clearTimers()
    if (!mounted()) {
      setMounted(true)
      setActive(false)
      showRaf = window.requestAnimationFrame(() => {
        showRaf = undefined
        updatePosition()
        setActive(true)
      })
      return
    }
    updatePosition()
    setActive(true)
  }

  function hide() {
    clearTimers()
    setActive(false)
    hideTimer = window.setTimeout(() => {
      hideTimer = undefined
      setMounted(false)
    }, 150)
  }

  createEffect(() => {
    if (!mounted()) return
    const onUpdate = () => updatePosition()
    window.addEventListener('scroll', onUpdate, true)
    window.addEventListener('resize', onUpdate)
    onCleanup(() => {
      window.removeEventListener('scroll', onUpdate, true)
      window.removeEventListener('resize', onUpdate)
    })
  })

  onCleanup(() => clearTimers())

  const tooltipStateClass = () => {
    if (active()) return 'opacity-100 translate-y-0'
    return placement() === 'top' ? 'opacity-0 -translate-y-1' : 'opacity-0 translate-y-1'
  }

  return (
    <span
      ref={(el) => (anchorEl = el)}
      class={cn('inline-flex', props.class)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusIn={show}
      onFocusOut={hide}
    >
      {props.children}
      <Show when={mounted()}>
        <Portal>
          <div
            ref={(el) => (tooltipEl = el)}
            class={cn(
              'pointer-events-none fixed z-[20000] w-max max-w-[240px] rounded-xl border border-slate-200 bg-white/90 px-2.5 py-1.5 text-[11px] leading-snug text-slate-700 shadow-2xl shadow-slate-900/10 transition-all duration-150 dark:border-slate-800 dark:bg-slate-950/90 dark:text-slate-200',
              tooltipStateClass(),
            )}
            style={{
              left: `${position().left}px`,
              top: `${position().top}px`,
            }}
            role="tooltip"
          >
            {props.content}
          </div>
        </Portal>
      </Show>
    </span>
  )
}
