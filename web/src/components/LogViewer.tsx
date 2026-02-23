import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import type { I18nTranslate } from '../app/i18n'
import type { ToastVariant } from '../app/types'
import { IconButton } from './ui/IconButton'
import { Input } from './ui/Input'
import { VirtualLines } from './ui/VirtualLines'

export type LogLine = { text: string; received_at_unix_ms?: number }

function formatIsoMs(unixMs: number) {
  try {
    return new Date(unixMs).toISOString()
  } catch {
    return String(unixMs)
  }
}

async function safeCopy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {}
  return false
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export type LogViewerProps = {
  t: I18nTranslate
  title?: string
  lines: LogLine[]
  loading?: boolean
  error?: unknown
  onClear?: () => void
  live?: boolean
  onLiveChange?: (live: boolean) => void
  storageKey?: string
  minimal?: boolean
  titleLevel?: 'page' | 'section'
  onToast?: (variant: ToastVariant, title: string, message?: string) => void
  class?: string
}

export function LogViewer(props: LogViewerProps) {
  const storageKey = () => props.storageKey ?? 'alloy.logviewer'
  const minimal = () => Boolean(props.minimal)

  const [internalLive, setInternalLive] = createSignal(true)
  const [wrap, setWrap] = createSignal(true)
  const [fontSize, setFontSize] = createSignal(12)
  const [includeTimestamp, setIncludeTimestamp] = createSignal(false)
  const [query, setQuery] = createSignal('')
  const [matchIdx, setMatchIdx] = createSignal(0)
  const [selectedLineIdx, setSelectedLineIdx] = createSignal<number | null>(null)
  const [copyLastN, setCopyLastN] = createSignal('200')
  const [goLineDraft, setGoLineDraft] = createSignal('')

  let scrollEl: HTMLDivElement | undefined
  let ignoreScrollOnce = false

  const live = () => (props.live === undefined ? internalLive() : props.live)
  const setLive = (value: boolean) => (props.onLiveChange ? props.onLiveChange(value) : setInternalLive(value))

  createEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey())
      if (!raw) return
      const parsed = JSON.parse(raw) as any
      if (typeof parsed?.wrap === 'boolean') setWrap(parsed.wrap)
      if (typeof parsed?.fontSize === 'number') setFontSize(clampNumber(parsed.fontSize, 10, 18))
      if (typeof parsed?.includeTimestamp === 'boolean') setIncludeTimestamp(parsed.includeTimestamp)
    } catch {}
  })

  createEffect(() => {
    try {
      localStorage.setItem(
        storageKey(),
        JSON.stringify({
          wrap: wrap(),
          fontSize: fontSize(),
          includeTimestamp: includeTimestamp(),
        }),
      )
    } catch {}
  })

  const lineHeight = createMemo(() => Math.round(fontSize() * 1.55))

  const matches = createMemo(() => {
    const q = query().trim()
    if (!q) return [] as number[]
    const needle = q.toLowerCase()
    const out: number[] = []
    for (let i = 0; i < props.lines.length; i++) {
      if (props.lines[i]?.text.toLowerCase().includes(needle)) out.push(i)
    }
    return out
  })

  createEffect(() => {
    query()
    setMatchIdx(0)
  })

  createEffect(() => {
    const list = matches()
    if (list.length === 0) {
      setMatchIdx(0)
      return
    }
    setMatchIdx((idx) => clampNumber(idx, 0, list.length - 1))
  })

  function isNearBottom(el: HTMLDivElement) {
    return el.scrollHeight - (el.scrollTop + el.clientHeight) < 48
  }

  function jumpToBottom(resumeLive = false) {
    const el = scrollEl
    if (!el) return
    if (resumeLive) setLive(true)
    const doScroll = () => {
      ignoreScrollOnce = true
      el.scrollTop = el.scrollHeight
    }
    doScroll()
    requestAnimationFrame(doScroll)
  }

  function scrollToLine(idx: number) {
    const el = scrollEl
    if (!el) return
    const top = idx * lineHeight()
    el.scrollTop = Math.max(0, top - el.clientHeight * 0.25)
  }

  createEffect(() => {
    props.lines.length
    if (!live()) return
    requestAnimationFrame(() => jumpToBottom(false))
  })

  const statusLabel = createMemo(() => {
    if (props.error) return props.t('logViewer.statusError')
    if (props.loading) return props.t('logViewer.statusLoading')
    if (!live()) return props.t('logViewer.statusPaused')
    return props.t('logViewer.statusLive')
  })

  const statusDot = createMemo(() => {
    if (props.loading) return 'bg-slate-500 animate-pulse'
    if (props.error) return 'bg-rose-500'
    if (!live()) return 'bg-amber-400'
    return 'bg-emerald-400'
  })

  function serializeLines(lines: LogLine[]): string {
    if (!includeTimestamp()) return lines.map((l) => l.text).join('\n')
    return lines
      .map((l) => {
        const ts = l.received_at_unix_ms
        const prefix = ts ? `${formatIsoMs(ts)} ` : ''
        return `${prefix}${l.text}`
      })
      .join('\n')
  }

  async function copySelected() {
    const idx = selectedLineIdx()
    if (idx == null) return
    const line = props.lines[idx]
    if (!line) return
    const ok = await safeCopy(serializeLines([line]))
    if (ok) props.onToast?.('success', props.t('toast.copied'), props.t('logViewer.copiedSelected'))
    else props.onToast?.('error', props.t('common.copyFailed'))
  }

  async function copyLast() {
    const n = Number.parseInt(copyLastN().trim(), 10)
    const count = Number.isFinite(n) && n > 0 ? n : 200
    const slice = props.lines.slice(Math.max(0, props.lines.length - count))
    const ok = await safeCopy(serializeLines(slice))
    if (ok) props.onToast?.('success', props.t('toast.copied'), props.t('logViewer.copiedTail', { count }))
    else props.onToast?.('error', props.t('common.copyFailed'))
  }

  async function copyAll() {
    const ok = await safeCopy(serializeLines(props.lines))
    if (ok) props.onToast?.('success', props.t('toast.copied'), props.t('logViewer.copiedAll', { count: props.lines.length }))
    else props.onToast?.('error', props.t('common.copyFailed'))
  }

  function jumpToMatch(delta: number) {
    const list = matches()
    if (list.length === 0) return
    setMatchIdx((cur) => {
      const next = (cur + delta + list.length) % list.length
      const lineIdx = list[next]
      setSelectedLineIdx(lineIdx)
      scrollToLine(lineIdx)
      return next
    })
  }

  const goLineNumber = createMemo(() => {
    const raw = goLineDraft().trim()
    if (!raw) return null
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n) || n <= 0) return null
    return n
  })

  const goLineInvalid = createMemo(() => {
    const raw = goLineDraft().trim()
    if (!raw) return false
    const n = goLineNumber()
    if (n == null) return true
    return n > props.lines.length
  })

  function jumpToLine() {
    const n = goLineNumber()
    if (n == null) return
    if (n > props.lines.length) return
    const idx = n - 1
    setSelectedLineIdx(idx)
    scrollToLine(idx)
  }

  const title = () => props.title ?? props.t('logViewer.title')

  return (
    <div class={props.class}>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <div class={props.titleLevel === 'page' ? 'text-page-title' : 'text-section-title'}>{title()}</div>
          <div class="inline-flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
            <span class={`h-2 w-2 rounded-full ${statusDot()}`} />
            <span>{statusLabel()}</span>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Input
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder={props.t('logViewer.search')}
            class={minimal() ? 'w-40' : 'w-44'}
            leftIcon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                <path
                  fill-rule="evenodd"
                  d="M9 3.5a5.5 5.5 0 104.473 8.714l2.656 2.657a.75.75 0 101.061-1.06l-2.657-2.657A5.5 5.5 0 009 3.5zM5 9a4 4 0 117.999.001A4 4 0 015 9z"
                  clip-rule="evenodd"
                />
              </svg>
            }
          />
          <Show
            when={matches().length > 0}
            fallback={<span class="text-[11px] text-slate-600 dark:text-slate-300">{props.t('logViewer.matchesNone')}</span>}
          >
            <span class="text-[11px] text-slate-600 dark:text-slate-300">
              {props.t('logViewer.matchesCount', { current: matchIdx() + 1, total: matches().length })}
            </span>
          </Show>
          <IconButton
            type="button"
            label={props.t('logViewer.prevMatch')}
            variant="ghost"
            disabled={matches().length === 0}
            onClick={() => jumpToMatch(-1)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
              <path
                fill-rule="evenodd"
                d="M12.78 15.53a.75.75 0 01-1.06 0l-5-5a.75.75 0 010-1.06l5-5a.75.75 0 111.06 1.06L8.31 10l4.47 4.47a.75.75 0 010 1.06z"
                clip-rule="evenodd"
              />
            </svg>
          </IconButton>
          <IconButton
            type="button"
            label={props.t('logViewer.nextMatch')}
            variant="ghost"
            disabled={matches().length === 0}
            onClick={() => jumpToMatch(1)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
              <path
                fill-rule="evenodd"
                d="M7.22 4.47a.75.75 0 011.06 0l5 5a.75.75 0 010 1.06l-5 5a.75.75 0 11-1.06-1.06L11.69 10 7.22 5.53a.75.75 0 010-1.06z"
                clip-rule="evenodd"
              />
            </svg>
          </IconButton>

          <Show when={!minimal()}>
              <IconButton
                type="button"
                label={wrap() ? props.t('logViewer.wrapOn') : props.t('logViewer.wrapOff')}
                variant="ghost"
                onClick={() => setWrap((v) => !v)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class={`h-4 w-4 ${wrap() ? 'text-amber-500' : ''}`}>
                <path
                  fill-rule="evenodd"
                  d="M2 5.75A.75.75 0 012.75 5h10a3.25 3.25 0 110 6.5H7.56l1.22 1.22a.75.75 0 11-1.06 1.06l-2.5-2.5a.75.75 0 010-1.06l2.5-2.5a.75.75 0 011.06 1.06L7.56 10h5.19a1.75 1.75 0 100-3.5h-10A.75.75 0 012 5.75z"
                  clip-rule="evenodd"
                />
              </svg>
            </IconButton>

            <div class="flex items-center gap-1">
              <IconButton
                type="button"
                label={props.t('logViewer.fontDecrease')}
                variant="ghost"
                disabled={fontSize() <= 10}
                onClick={() => setFontSize((v) => clampNumber(v - 1, 10, 18))}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                  <path d="M5 10a.75.75 0 01.75-.75h8.5a.75.75 0 010 1.5h-8.5A.75.75 0 015 10z" />
                </svg>
              </IconButton>
              <span class="w-8 text-center text-[11px] text-slate-600 dark:text-slate-300">{fontSize()}px</span>
              <IconButton
                type="button"
                label={props.t('logViewer.fontIncrease')}
                variant="ghost"
                disabled={fontSize() >= 18}
                onClick={() => setFontSize((v) => clampNumber(v + 1, 10, 18))}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                  <path
                    fill-rule="evenodd"
                    d="M10 4.25a.75.75 0 01.75.75v4.25H15a.75.75 0 010 1.5h-4.25V15a.75.75 0 01-1.5 0v-4.25H5a.75.75 0 010-1.5h4.25V5a.75.75 0 01.75-.75z"
                    clip-rule="evenodd"
                  />
                </svg>
              </IconButton>
            </div>
          </Show>

          <IconButton
            type="button"
            label={live() ? props.t('logViewer.pauseLive') : props.t('logViewer.resumeLive')}
            variant="ghost"
            onClick={() => {
              const next = !live()
              setLive(next)
              if (next) jumpToBottom(false)
            }}
          >
            <Show
              when={live()}
              fallback={
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4 text-amber-500">
                  <path d="M4.5 3.25a.75.75 0 011.18-.62l10.5 7.25a.75.75 0 010 1.24l-10.5 7.25A.75.75 0 014.5 17.75V3.25z" />
                </svg>
              }
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                <path d="M7 4.75A.75.75 0 017.75 4h.5a.75.75 0 01.75.75v10.5a.75.75 0 01-.75.75h-.5A.75.75 0 017 15.25V4.75zM11 4.75A.75.75 0 0111.75 4h.5a.75.75 0 01.75.75v10.5a.75.75 0 01-.75.75h-.5a.75.75 0 01-.75-.75V4.75z" />
              </svg>
            </Show>
          </IconButton>

          <IconButton type="button" label={props.t('logViewer.jumpBottom')} variant="ghost" onClick={() => jumpToBottom(true)}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
              <path
                fill-rule="evenodd"
                d="M10 14.5a.75.75 0 01-.53-.22l-5-5a.75.75 0 111.06-1.06L10 12.69l4.47-4.47a.75.75 0 111.06 1.06l-5 5a.75.75 0 01-.53.22z"
                clip-rule="evenodd"
              />
            </svg>
          </IconButton>

          <Show when={minimal()}>
            <IconButton type="button" label={props.t('logViewer.copyTail')} variant="secondary" onClick={() => copyLast()}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
              </svg>
            </IconButton>
          </Show>

          <Show when={!minimal()}>
            <form
              class="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                jumpToLine()
              }}
            >
              <Input
                value={goLineDraft()}
                onInput={(e) => setGoLineDraft(e.currentTarget.value)}
                class="w-24"
                placeholder={props.t('logViewer.lineNumber')}
                invalid={goLineInvalid()}
              />
              <IconButton
                type="submit"
                label={props.t('logViewer.goToLine')}
                variant="secondary"
                disabled={goLineInvalid() || !goLineDraft().trim()}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                  <path
                    fill-rule="evenodd"
                    d="M3 10a.75.75 0 01.75-.75h10.638L10.22 5.28a.75.75 0 111.06-1.06l5.25 5.25a.75.75 0 010 1.06l-5.25 5.25a.75.75 0 11-1.06-1.06l4.168-4.17H3.75A.75.75 0 013 10z"
                    clip-rule="evenodd"
                  />
                </svg>
              </IconButton>
            </form>

            <div class="flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white/76 px-2 py-1 dark:border-slate-800 dark:bg-slate-950/60">
              <IconButton
                type="button"
                label={props.t('logViewer.copySelected')}
                variant="secondary"
                disabled={selectedLineIdx() == null}
                onClick={() => copySelected()}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                  <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                  <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                </svg>
              </IconButton>

              <div class="flex items-center gap-2">
                <Input value={copyLastN()} onInput={(e) => setCopyLastN(e.currentTarget.value)} class="w-16" />
                <IconButton type="button" label={props.t('logViewer.copyLastN')} variant="secondary" onClick={() => copyLast()}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                    <path
                      fill-rule="evenodd"
                      d="M10 3a7 7 0 100 14 7 7 0 000-14zM8.75 7.5a.75.75 0 011.5 0v2.19l1.47.98a.75.75 0 11-.84 1.25l-1.8-1.2a.75.75 0 01-.33-.62V7.5z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </IconButton>
              </div>

              <IconButton type="button" label={props.t('logViewer.copyAll')} variant="secondary" onClick={() => copyAll()}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                  <path
                    fill-rule="evenodd"
                    d="M3 4.75A2.75 2.75 0 015.75 2h5.5A2.75 2.75 0 0114 4.75v10.5A2.75 2.75 0 0111.25 18h-5.5A2.75 2.75 0 013 15.25V4.75zm5.5 1a.75.75 0 000 1.5h3a.75.75 0 000-1.5h-3zM7.75 9a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5zM7.75 12.25a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5z"
                    clip-rule="evenodd"
                  />
                  <path d="M15.5 6.5a.75.75 0 01.75.75v8A3.25 3.25 0 0113 18.5h-.25a.75.75 0 010-1.5H13a1.75 1.75 0 001.75-1.75v-8a.75.75 0 01.75-.75z" />
                </svg>
              </IconButton>
            </div>
            <span class="text-[11px] text-slate-500 dark:text-slate-400">{props.t('logViewer.copyActions')}</span>
          </Show>

          <IconButton type="button" label={props.t('logViewer.clear')} variant="ghost" disabled={!props.onClear} onClick={() => props.onClear?.()}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
              <path
                fill-rule="evenodd"
                d="M8.75 2.75A.75.75 0 019.5 2h1a.75.75 0 01.75.75V3h3.5a.75.75 0 010 1.5h-.918l-.764 10.694A2.75 2.75 0 0111.327 18H8.673a2.75 2.75 0 01-2.741-2.806L5.168 4.5H4.25a.75.75 0 010-1.5h3.5v-.25zm1.5.25v.25h-1.5V3h1.5z"
                clip-rule="evenodd"
              />
            </svg>
          </IconButton>
        </div>
      </div>

      <Show when={!minimal()}>
        <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <label
              class="flex items-center gap-2 text-[12px] font-medium text-slate-700 dark:text-slate-200"
              title={props.t('logViewer.includeTimestampHint')}
            >
              <input
                type="checkbox"
                class="h-4 w-4 rounded border-slate-300 text-amber-600 focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:border-slate-700 dark:bg-slate-950/60 dark:text-amber-400 dark:focus-visible:ring-offset-slate-950"
                checked={includeTimestamp()}
                onChange={(e) => setIncludeTimestamp(e.currentTarget.checked)}
              />
              {props.t('logViewer.timestamps')}
            </label>
          </div>
        </div>
      </Show>

      <div class="mt-3">
        <VirtualLines
          lines={props.lines.map((l) => l.text)}
          ariaLabel={props.t('logViewer.linesAria')}
          defaultAriaLabel={props.t('logViewer.linesAria')}
          wrap={wrap()}
          fontSize={fontSize()}
          lineHeight={lineHeight()}
          highlightQuery={query()}
          selectedIndex={selectedLineIdx()}
          onSelectIndex={(idx) => setSelectedLineIdx(idx)}
          onScrollEl={(el) => {
            scrollEl = el
            const onScroll = () => {
              if (ignoreScrollOnce) {
                ignoreScrollOnce = false
                return
              }
              if (!live()) return
              if (!isNearBottom(el)) setLive(false)
            }
            el.addEventListener('scroll', onScroll, { passive: true })
            requestAnimationFrame(() => {
              if (!live()) return
              if (props.lines.length === 0) return
              jumpToBottom(false)
            })
            return () => el.removeEventListener('scroll', onScroll)
          }}
          class="!bg-slate-950 !text-slate-100 !border-slate-800 max-h-[55vh] min-h-[240px]"
          empty={<div class="p-3 text-[12px] text-slate-400">{props.t('logViewer.emptyHint')}</div>}
        />
      </div>
    </div>
  )
}
