import type { JSX } from 'solid-js'
import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { cn } from './cn'

function highlightText(text: string, query: string): JSX.Element {
  const q = query.trim()
  if (!q) return text
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  const parts: JSX.Element[] = []
  let i = 0
  while (i < text.length) {
    const idx = lower.indexOf(needle, i)
    if (idx < 0) {
      parts.push(text.slice(i))
      break
    }
    if (idx > i) parts.push(text.slice(i, idx))
    parts.push(
      <mark class="rounded bg-amber-400/25 px-0.5 text-current">
        {text.slice(idx, idx + needle.length)}
      </mark>,
    )
    i = idx + needle.length
  }
  return <>{parts}</>
}

export type VirtualLinesProps = {
  lines: string[]
  fontSize?: number
  lineHeight?: number
  wrap?: boolean
  showLineNumbers?: boolean
  highlightQuery?: string
  selectedIndex?: number | null
  onSelectIndex?: (idx: number) => void
  renderLine?: (line: string, idx: number) => JSX.Element
  class?: string
  empty?: JSX.Element
  onScrollEl?: (el: HTMLDivElement) => void | (() => void)
}

export function VirtualLines(props: VirtualLinesProps) {
  let scrollEl: HTMLDivElement | undefined
  const [scrollTop, setScrollTop] = createSignal(0)
  const [viewportHeight, setViewportHeight] = createSignal(0)

  const fontSize = () => props.fontSize ?? 12
  const lineHeight = () => props.lineHeight ?? Math.round(fontSize() * 1.55)
  const overscan = () => 12

  onMount(() => {
    const el = scrollEl
    if (!el) return
    const cleanup = props.onScrollEl?.(el)
    if (typeof cleanup === 'function') onCleanup(() => cleanup())

    const updateViewport = () => setViewportHeight(el.clientHeight)
    updateViewport()

    const onScroll = () => setScrollTop(el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })

    const ro = new ResizeObserver(() => updateViewport())
    ro.observe(el)

    onCleanup(() => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    })
  })

  const totalHeightPx = createMemo(() => props.lines.length * lineHeight())

  const range = createMemo(() => {
    const lh = lineHeight()
    const start = Math.max(0, Math.floor(scrollTop() / lh) - overscan())
    const end = Math.min(props.lines.length, Math.ceil((scrollTop() + viewportHeight()) / lh) + overscan())
    return { start, end, offsetTopPx: start * lh }
  })

  const visibleLines = createMemo(() => props.lines.slice(range().start, range().end))

  const digits = createMemo(() => String(props.lines.length).length)

  return (
    <div
      ref={(el) => (scrollEl = el)}
      class={cn('relative overflow-auto rounded-xl border border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200', props.class)}
      style={{
        'font-size': `${fontSize()}px`,
        'line-height': `${lineHeight()}px`,
      }}
      role="region"
      aria-label="Lines"
    >
      <Show when={props.lines.length > 0} fallback={props.empty ?? <div class="p-3 text-[12px] text-slate-500">(no output)</div>}>
        <Show
          when={!props.wrap}
          fallback={
            <div class="p-3 font-mono">
              <For each={props.lines}>
                {(line, idx) => {
                  const i = idx()
                  const selected = () => props.selectedIndex === i
                  return (
                    <div
                      class={cn(
                        'flex w-full items-start gap-3 rounded-lg px-2 py-0.5 transition-colors',
                        selected() ? 'bg-amber-500/10' : 'hover:bg-slate-200/40 dark:hover:bg-slate-900/40',
                      )}
                      onClick={() => props.onSelectIndex?.(i)}
                    >
                      <Show when={props.showLineNumbers}>
                        <div class="select-none text-right text-slate-500 dark:text-slate-500" style={{ width: `${digits()}ch` }}>
                          {i + 1}
                        </div>
                      </Show>
                      <div class="min-w-0 flex-1 whitespace-pre-wrap break-words">
                        {props.renderLine ? props.renderLine(line, i) : highlightText(line, props.highlightQuery ?? '')}
                      </div>
                    </div>
                  )
                }}
              </For>
            </div>
          }
        >
          {/* Virtualized rendering assumes fixed line height (wrap = false). */}
          <div style={{ height: `${totalHeightPx()}px` }} />
          <div class="absolute left-0 right-0 top-0 font-mono" style={{ transform: `translateY(${range().offsetTopPx}px)` }}>
            <For each={visibleLines()}>
              {(line, idx) => {
                const i = () => range().start + idx()
                const selected = () => props.selectedIndex === i()
                return (
                  <div
                    class={cn(
                      'flex w-full items-center gap-3 px-3 transition-colors',
                      selected() ? 'bg-amber-500/10' : 'hover:bg-slate-200/40 dark:hover:bg-slate-900/40',
                    )}
                    style={{ height: `${lineHeight()}px` }}
                    onClick={() => props.onSelectIndex?.(i())}
                  >
                    <Show when={props.showLineNumbers}>
                      <div class="select-none text-right text-slate-500 dark:text-slate-500" style={{ width: `${digits()}ch` }}>
                        {i() + 1}
                      </div>
                    </Show>
                    <div class="min-w-0 flex-1 whitespace-pre">
                      {props.renderLine ? props.renderLine(line, i()) : highlightText(line, props.highlightQuery ?? '')}
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  )
}
