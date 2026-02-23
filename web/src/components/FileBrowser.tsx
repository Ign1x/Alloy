import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import type { I18nTranslate } from '../app/i18n'
import type { ToastVariant } from '../app/types'
import { isAlloyApiError, rspc } from '../rspc'
import { Badge } from './ui/Badge'
import { cn } from './ui/cn'
import { DataBoundary } from './ui/DataBoundary'
import { EmptyState } from './ui/EmptyState'
import { ErrorState } from './ui/ErrorState'
import { IconButton } from './ui/IconButton'
import { Input } from './ui/Input'
import { Skeleton } from './ui/Skeleton'
import { VirtualLines } from './ui/VirtualLines'
import { LogViewer, type LogLine } from './LogViewer'

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  const sign = bytes < 0 ? '-' : ''
  let v = Math.abs(bytes)
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const decimals = i === 0 ? 0 : v >= 10 ? 1 : 2
  return `${sign}${v.toFixed(decimals)}${units[i]}`
}

function formatRelativeTime(unixMs: number | null | undefined, t: I18nTranslate): string {
  if (!unixMs || !Number.isFinite(unixMs) || unixMs <= 0) return '—'
  const deltaMs = Date.now() - unixMs
  const sec = Math.floor(deltaMs / 1000)
  if (sec < 10) return t('fileBrowser.relativeJustNow')
  if (sec < 60) return t('fileBrowser.relativeSecondsAgo', { count: sec })
  const min = Math.floor(sec / 60)
  if (min < 60) return t('fileBrowser.relativeMinutesAgo', { count: min })
  const hr = Math.floor(min / 60)
  if (hr < 48) return t('fileBrowser.relativeHoursAgo', { count: hr })
  const day = Math.floor(hr / 24)
  return t('fileBrowser.relativeDaysAgo', { count: day })
}

function parseUnixMs(raw: unknown): number | null {
  if (raw == null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null
  if (typeof raw === 'string') {
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return null
}

function normalizePath(raw: string): string {
  const cleaned = raw.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  return cleaned.replace(/\/{2,}/g, '/')
}

function joinPath(dir: string, name: string): string {
  const d = normalizePath(dir)
  if (!d) return name
  return `${d}/${name}`
}

function parentPath(dir: string): string {
  const d = normalizePath(dir)
  const idx = d.lastIndexOf('/')
  if (idx <= 0) return ''
  return d.slice(0, idx)
}

function detectLanguage(path: string): 'json' | 'yaml' | 'toml' | 'ini' | 'text' {
  const lower = path.toLowerCase()
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml'
  if (lower.endsWith('.toml')) return 'toml'
  if (lower.endsWith('.ini') || lower.endsWith('.properties') || lower.endsWith('.cfg') || lower.endsWith('.conf')) return 'ini'
  return 'text'
}

function highlightJsonLine(line: string) {
  const re = /("(?:\\.|[^"\\])*")|(\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)|([{}[\],:])/g
  const parts: any[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) != null) {
    if (m.index > last) parts.push(line.slice(last, m.index))
    const [token, str, num, kw, punc] = m
    if (str) {
      const after = line.slice(m.index + token.length)
      const isKey = /^\s*:/.test(after)
      parts.push(
        <span class={isKey ? 'text-sky-700 dark:text-sky-300' : 'text-emerald-700 dark:text-emerald-300'}>{str}</span>,
      )
    } else if (num) parts.push(<span class="text-violet-700 dark:text-violet-300">{num}</span>)
    else if (kw) parts.push(<span class="text-amber-700 dark:text-amber-300">{kw}</span>)
    else if (punc) parts.push(<span class="text-slate-500 dark:text-slate-400">{punc}</span>)
    else parts.push(token)
    last = m.index + token.length
  }
  if (last < line.length) parts.push(line.slice(last))
  return <>{parts}</>
}

function highlightKeyValueLine(line: string) {
  const m = /^(\s*)([^#:=]+?)(\s*[:=]\s*)(.*)$/.exec(line)
  if (!m) return line
  const [, indent, key, sep, rest] = m
  return (
    <>
      {indent}
      <span class="text-sky-700 dark:text-sky-300">{key}</span>
      <span class="text-slate-500 dark:text-slate-400">{sep}</span>
      <span class="text-emerald-700 dark:text-emerald-300">{rest}</span>
    </>
  )
}

function fileErrorSuggestion(err: unknown, t: I18nTranslate): { title: string; hints: string[] } | null {
  if (!isAlloyApiError(err)) return null
  const code = err.data.code
  if (code === 'not_found') {
    return { title: t('fileBrowser.errorNotFoundTitle'), hints: [t('fileBrowser.errorRefreshRetryHint')] }
  }
  if (code === 'permission_denied') {
    return {
      title: t('fileBrowser.errorPermissionDeniedTitle'),
      hints: [t('fileBrowser.errorCheckPermissionsHint')],
    }
  }
  if (code === 'invalid_utf8') {
    return {
      title: t('fileBrowser.errorUnsupportedFileTitle'),
      hints: [t('fileBrowser.errorUtf8OnlyHint')],
    }
  }
  if (code === 'invalid_param') {
    return { title: t('fileBrowser.errorInvalidRequestTitle'), hints: [t('fileBrowser.errorSelectDifferentHint')] }
  }
  if (code === 'agent_unreachable') {
    return { title: t('fileBrowser.errorAgentOfflineTitle'), hints: [t('fileBrowser.errorRetryReconnectHint')] }
  }
  if (code === 'timeout') {
    return { title: t('fileBrowser.errorTimedOutTitle'), hints: [t('fileBrowser.errorRetryRequestHint')] }
  }
  return null
}

type FsEntry = { name: string; is_dir: boolean; size_bytes: number; modified_unix_ms?: string | number | null }

type FileSortKey = 'name' | 'size' | 'modified'

function compareName(aRaw: string, bRaw: string): number {
  const a = aRaw.trim()
  const b = bRaw.trim()
  const aNum = a.length > 0 && a.charCodeAt(0) >= 48 && a.charCodeAt(0) <= 57
  const bNum = b.length > 0 && b.charCodeAt(0) >= 48 && b.charCodeAt(0) <= 57
  if (aNum !== bNum) return aNum ? -1 : 1
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

export type FileBrowserProps = {
  t: I18nTranslate
  enabled: boolean
  fsNodeId?: string | null
  title?: string
  initialPath?: string
  initialSelectedFile?: string | null
  onOpenSettings?: () => void
  rootPath?: string
  rootLabel?: string
  titleLevel?: 'page' | 'section'
  onToast?: (variant: ToastVariant, title: string, message?: string) => void
  class?: string
}

export function FileBrowser(props: FileBrowserProps) {
  const [path, setPath] = createSignal('')
  const [backStack, setBackStack] = createSignal<string[]>([])
  const [forwardStack, setForwardStack] = createSignal<string[]>([])
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null)

  const [sortKey, setSortKey] = createSignal<FileSortKey>('name')
  const [sortDir, setSortDir] = createSignal<'asc' | 'desc'>('asc')

  const [pathDraft, setPathDraft] = createSignal('')

  const rootPath = createMemo(() => normalizePath(props.rootPath ?? ''))

  const fsNodeId = createMemo(() => {
    const raw = (props.fsNodeId ?? '').trim()
    return raw.length > 0 ? raw : null
  })

  createEffect(() => {
    const initialSelected = props.initialSelectedFile ? normalizePath(props.initialSelectedFile) : ''
    if (initialSelected) {
      setPath(parentPath(initialSelected))
      setSelectedFile(initialSelected)
    } else {
      const base = normalizePath(props.initialPath ?? '') || rootPath()
      setPath(base)
      setSelectedFile(null)
    }
    setBackStack([])
    setForwardStack([])
  })

  createEffect(() => setPathDraft(path()))

  const resolvedPathDraft = createMemo(() => {
    const draft = normalizePath(pathDraft())
    const root = rootPath()
    if (root && draft && !draft.startsWith(root)) return `${root}/${draft}`
    return draft || root
  })

  const canNavigateToDraft = createMemo(() => resolvedPathDraft() !== path())

  function navigate(nextRaw: string, mode: 'push' | 'replace' = 'push') {
    const root = rootPath()
    const next = normalizePath(nextRaw) || root
    const cur = path()
    if (next === cur) return
    if (mode === 'push') {
      setBackStack((prev) => [...prev, cur].slice(-50))
      setForwardStack([])
    }
    setPath(next)
    setSelectedFile(null)
  }

  function goBack() {
    const prev = backStack()
    if (!prev.length) return
    const cur = path()
    const next = prev[prev.length - 1] ?? ''
    setBackStack(prev.slice(0, -1))
    setForwardStack((f) => [...f, cur].slice(-50))
    setPath(next)
    setSelectedFile(null)
  }

  function goForward() {
    const fwd = forwardStack()
    if (!fwd.length) return
    const cur = path()
    const next = fwd[fwd.length - 1] ?? ''
    setForwardStack(fwd.slice(0, -1))
    setBackStack((b) => [...b, cur].slice(-50))
    setPath(next)
    setSelectedFile(null)
  }

  const fsList = rspc.createQuery(
    () => ['fs.listDir', { path: path() ? path() : null, node_id: fsNodeId() ?? '__control__' }],
    () => ({ enabled: props.enabled, refetchOnWindowFocus: false, staleTime: 0 }),
  )

  const [lastRefreshAt, setLastRefreshAt] = createSignal<number | null>(null)
  createEffect(() => {
    if (!fsList.data) return
    setLastRefreshAt(Date.now())
  })

  const entries = createMemo(() => (fsList.data?.entries ?? []) as FsEntry[])

  const sortedEntries = createMemo(() => {
    const key = sortKey()
    const dir = sortDir()
    const list = [...entries()]
    const mult = dir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
      if (key === 'size') return mult * ((a.size_bytes ?? 0) - (b.size_bytes ?? 0))
      if (key === 'modified') return mult * ((parseUnixMs(a.modified_unix_ms) ?? 0) - (parseUnixMs(b.modified_unix_ms) ?? 0))
      return mult * compareName(a.name, b.name)
    })
    return list
  })

  function toggleSort(nextKey: FileSortKey) {
    if (sortKey() === nextKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(nextKey)
    setSortDir(nextKey === 'name' ? 'asc' : 'desc')
  }

  const breadcrumbs = createMemo(() => {
    const root = rootPath()
    const p = path()
    const rel = root && p.startsWith(root) ? p.slice(root.length).replace(/^\/+/, '') : p
    if (!rel) return [] as { name: string; path: string }[]
    const segs = rel.split('/').filter(Boolean)
    const out: { name: string; path: string }[] = []
    let cur = root
    for (const s of segs) {
      cur = cur ? `${cur}/${s}` : s
      out.push({ name: s, path: cur })
    }
    return out
  })

  const selectedFileName = createMemo(() => {
    const p = selectedFile()
    if (!p) return null
    const cleaned = normalizePath(p)
    const idx = cleaned.lastIndexOf('/')
    return idx >= 0 ? cleaned.slice(idx + 1) : cleaned
  })

  const selectedIsLog = createMemo(() => {
    const p = selectedFile()
    if (!p || !fsNodeId()) return false
    return p.toLowerCase().endsWith('.log')
  })

  const READ_LIMIT = 256 * 1024

  const fileText = rspc.createQuery(
    () => {
      const p = selectedFile() ?? ''
      return ['fs.readFile', { path: p, offset: 0, limit: READ_LIMIT, node_id: fsNodeId() ?? '__control__' }]
    },
    () => ({
      enabled: props.enabled && !!selectedFile() && !selectedIsLog(),
      refetchOnWindowFocus: false,
      staleTime: 0,
    }),
  )

  const [logLive, setLogLive] = createSignal(true)
  const [logCursor, setLogCursor] = createSignal<string | null>(null)
  const [logLines, setLogLines] = createSignal<LogLine[]>([])

  const logTail = rspc.createQuery(
    () => [
      'log.tailFile',
      {
        path: selectedFile() ?? '',
        cursor: logCursor(),
        limit_bytes: 65536,
        max_lines: 400,
      },
    ],
    () => ({
      enabled: props.enabled && !!selectedFile() && selectedIsLog() && !!fsNodeId(),
      refetchInterval: logLive() ? 1000 : false,
      refetchOnWindowFocus: false,
    }),
  )

  createEffect(() => {
    selectedFile()
    setLogLive(true)
    setLogCursor(null)
    setLogLines([])
    setSelectedLineIdx(null)
  })

  createEffect(() => {
    const lines = logTail.data?.lines
    if (!lines || lines.length === 0) return
    const now = Date.now()
    setLogLines((prev) => [...prev, ...lines.map((text: string) => ({ text, received_at_unix_ms: now }))].slice(-2000))
  })

  createEffect(() => {
    if (!logLive()) return
    const next = logTail.data?.next_cursor
    if (next) setLogCursor(next)
  })

  const fileLines = createMemo(() => {
    const text = fileText.data?.text
    if (!text) return [] as string[]
    return text.replace(/\r\n/g, '\n').split('\n')
  })

  const fileLanguage = createMemo(() => {
    const p = selectedFile()
    if (!p) return 'text' as const
    return detectLanguage(p)
  })

  const [goLineDraft, setGoLineDraft] = createSignal('')
  const [selectedLineIdx, setSelectedLineIdx] = createSignal<number | null>(null)
  let codeScrollEl: HTMLDivElement | undefined

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
    const max = fileLines().length
    if (max > 0 && n > max) return true
    return false
  })

  function jumpToLine() {
    const n = goLineNumber()
    if (n == null) return
    const max = fileLines().length
    if (max > 0 && n > max) return
    const idx = n - 1
    const lh = 18
    if (codeScrollEl) codeScrollEl.scrollTop = Math.max(0, idx * lh - codeScrollEl.clientHeight * 0.25)
    setSelectedLineIdx(idx)
  }

  async function copyPath(pathValue: string) {
    try {
      await navigator.clipboard.writeText(pathValue)
      props.onToast?.('success', props.t('toast.copied'), props.t('fileBrowser.copiedPath'))
    } catch {
      props.onToast?.('error', props.t('common.copyFailed'))
    }
  }

  async function copyPreviewText() {
    try {
      await navigator.clipboard.writeText(fileText.data?.text ?? '')
      props.onToast?.('success', props.t('toast.copied'), props.t('fileBrowser.copiedFile'))
    } catch {
      props.onToast?.('error', props.t('common.copyFailed'))
    }
  }

  async function copySelectedLine() {
    const idx = selectedLineIdx()
    if (idx == null) return
    const line = fileLines()[idx]
    if (line == null) return
    try {
      await navigator.clipboard.writeText(line)
      props.onToast?.('success', props.t('toast.copied'), props.t('fileBrowser.copiedLine'))
    } catch {
      props.onToast?.('error', props.t('common.copyFailed'))
    }
  }

  return (
    <div class={cn('flex min-h-0 flex-1 flex-col gap-3 md:flex-row', props.class)}>
      <aside class="surface-glass flex w-full flex-none flex-col border-b md:w-[372px] md:border-b-0 md:border-r max-h-[52vh] md:max-h-none">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/90 bg-white/76 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/58">
              <div class="min-w-0">
              <div class={props.titleLevel === 'page' ? 'text-page-title' : 'text-section-title'}>{props.title ?? props.t('fileBrowser.title')}</div>
              <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <Show when={lastRefreshAt()}>
                  {(timeValue) => <span>{props.t('fileBrowser.updatedAt', { value: formatRelativeTime(timeValue(), props.t) })}</span>}
                </Show>
                <Show when={fsList.isPending}>
                  <span class="inline-flex items-center gap-1">
                    <span class="h-1.5 w-1.5 rounded-full bg-slate-500 animate-pulse" />
                    {props.t('fileBrowser.statusLoading')}
                  </span>
                </Show>
                <Show when={fsList.isError}>
                  <span class="inline-flex items-center gap-1">
                    <span class="h-1.5 w-1.5 rounded-full bg-rose-500" />
                    {props.t('fileBrowser.statusError')}
                  </span>
                </Show>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <IconButton
                type="button"
                label={props.t('fileBrowser.back')}
                variant="ghost"
                disabled={backStack().length === 0}
                onClick={() => goBack()}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                  <path
                    fill-rule="evenodd"
                    d="M11.78 15.53a.75.75 0 01-1.06 0l-5-5a.75.75 0 010-1.06l5-5a.75.75 0 111.06 1.06L7.31 10l4.47 4.47a.75.75 0 010 1.06z"
                    clip-rule="evenodd"
                  />
                </svg>
              </IconButton>
              <IconButton
                type="button"
                label={props.t('fileBrowser.forward')}
                variant="ghost"
                disabled={forwardStack().length === 0}
                onClick={() => goForward()}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                  <path
                    fill-rule="evenodd"
                    d="M8.22 4.47a.75.75 0 011.06 0l5 5a.75.75 0 010 1.06l-5 5a.75.75 0 11-1.06-1.06L12.69 10 8.22 5.53a.75.75 0 010-1.06z"
                    clip-rule="evenodd"
                  />
                </svg>
              </IconButton>
              <IconButton
                type="button"
                label={props.t('fileBrowser.up')}
                variant="ghost"
                disabled={!path() || path() === rootPath()}
                onClick={() => {
                  const root = rootPath()
                  const parent = parentPath(path())
                  if (root && !parent.startsWith(root)) navigate(root)
                  else navigate(parent)
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                  <path
                    fill-rule="evenodd"
                    d="M10 3.25a.75.75 0 01.53.22l6 6a.75.75 0 11-1.06 1.06l-4.72-4.72V16a.75.75 0 01-1.5 0V5.81L4.53 10.53a.75.75 0 11-1.06-1.06l6-6A.75.75 0 0110 3.25z"
                    clip-rule="evenodd"
                  />
                </svg>
              </IconButton>
              <IconButton type="button" label={props.t('fileBrowser.refresh')} variant="ghost" onClick={() => fsList.refetch()}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                  <path
                    fill-rule="evenodd"
                    d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466.75.75 0 00-1.06 1.06 7 7 0 0011.698-3.132.75.75 0 00-1.437-.394z"
                    clip-rule="evenodd"
                  />
                  <path
                    fill-rule="evenodd"
                    d="M4.688 8.576a5.5 5.5 0 019.201-2.466.75.75 0 001.06-1.06A7 7 0 003.25 8.182a.75.75 0 001.438.394z"
                    clip-rule="evenodd"
                  />
                </svg>
              </IconButton>
            </div>
          </div>

          <div class="border-b border-slate-200/90 bg-white/74 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/56">
            <div class="flex flex-wrap items-center gap-1 text-[12px] text-slate-600 dark:text-slate-300">
              <button
                type="button"
                class="ring-focus motion-surface rounded-lg px-2 py-1 hover:bg-slate-100/85 dark:hover:bg-slate-900/70"
                onClick={() => navigate(rootPath())}
              >
                {props.rootLabel ?? (rootPath() ? rootPath() : '/data')}
              </button>
              <For each={breadcrumbs()}>
                {(b) => (
                  <>
                    <span class="text-slate-400">/</span>
                    <button
                      type="button"
                      class="ring-focus motion-surface rounded-lg px-2 py-1 hover:bg-slate-100/85 dark:hover:bg-slate-900/70"
                      onClick={() => navigate(b.path)}
                      title={b.path}
                    >
                      {b.name}
                    </button>
                  </>
                )}
              </For>
            </div>

            <form
              class="mt-2"
              onSubmit={(e) => {
                e.preventDefault()
                navigate(resolvedPathDraft())
              }}
            >
              <Input
                value={pathDraft()}
                onInput={(e) => setPathDraft(e.currentTarget.value)}
                placeholder={
                  rootPath() ? props.t('fileBrowser.pathPlaceholderRoot') : props.t('fileBrowser.pathPlaceholderData')
                }
                rightIcon={
                  <button
                    type="submit"
                      class={cn(
                        'ring-focus motion-surface rounded-lg p-1.5 disabled:cursor-not-allowed disabled:opacity-40',
                        canNavigateToDraft()
                          ? 'hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-900/60 dark:hover:text-slate-200'
                          : '',
                    )}
                    disabled={!canNavigateToDraft()}
                    aria-label={props.t('fileBrowser.go')}
                    title={canNavigateToDraft() ? props.t('fileBrowser.goEnter') : props.t('fileBrowser.alreadyHere')}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                      <path
                        fill-rule="evenodd"
                        d="M3 10a.75.75 0 01.75-.75h10.638L10.22 5.28a.75.75 0 111.06-1.06l5.25 5.25a.75.75 0 010 1.06l-5.25 5.25a.75.75 0 11-1.06-1.06l4.168-4.17H3.75A.75.75 0 013 10z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </button>
                }
              />
            </form>
          </div>

          <div class="min-h-0 flex-1 overflow-auto p-2 md:p-3">
            <div class="grid grid-cols-[1fr_96px_92px] gap-1 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 sm:grid-cols-[1fr_110px_120px]">
              <button type="button" class="ring-focus motion-surface rounded-md px-1 text-left hover:text-slate-700 dark:hover:text-slate-200" onClick={() => toggleSort('name')}>
                {props.t('fileBrowser.columnName')} {sortKey() === 'name' ? (sortDir() === 'asc' ? '▲' : '▼') : ''}
              </button>
              <button type="button" class="ring-focus motion-surface rounded-md px-1 text-right hover:text-slate-700 dark:hover:text-slate-200" onClick={() => toggleSort('size')}>
                {props.t('fileBrowser.columnSize')} {sortKey() === 'size' ? (sortDir() === 'asc' ? '▲' : '▼') : ''}
              </button>
              <button type="button" class="ring-focus motion-surface rounded-md px-1 text-right hover:text-slate-700 dark:hover:text-slate-200" onClick={() => toggleSort('modified')}>
                {props.t('fileBrowser.columnModified')} {sortKey() === 'modified' ? (sortDir() === 'asc' ? '▲' : '▼') : ''}
              </button>
            </div>

            <DataBoundary
              t={props.t}
              loading={fsList.isPending}
              loadingLines={6}
              error={fsList.error}
              errorTitle={props.t('fileBrowser.errorListDirTitle')}
              hasData={sortedEntries().length > 0}
              empty={sortedEntries().length === 0}
              emptyTitle={props.t('fileBrowser.emptyDirectory')}
              emptyDescription={props.t('fileBrowser.emptyDirectoryHint')}
              emptyActions={
                  <IconButton type="button" label={props.t('fileBrowser.refresh')} variant="secondary" onClick={() => fsList.refetch()}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                    <path
                      fill-rule="evenodd"
                      d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466.75.75 0 00-1.06 1.06 7 7 0 0011.698-3.132.75.75 0 00-1.437-.394z"
                      clip-rule="evenodd"
                    />
                    <path
                      fill-rule="evenodd"
                      d="M4.688 8.576a5.5 5.5 0 019.201-2.466.75.75 0 001.06-1.06A7 7 0 003.25 8.182a.75.75 0 001.438.394z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </IconButton>
              }
              onRetry={() => fsList.refetch()}
              onOpenSettings={props.onOpenSettings}
              settingsCtaLabel={props.t('downloads.openSettings')}
            >
              <div class="space-y-0.5">
                <For each={sortedEntries()}>
                  {(e) => {
                    const fullPath = () => joinPath(path(), e.name)
                    const isSelected = () => selectedFile() === fullPath()
                    const modified = () => parseUnixMs(e.modified_unix_ms)
                    return (
                      <button
                        type="button"
                        class={`ring-focus motion-surface grid w-full grid-cols-[1fr_96px_92px] items-center gap-1 rounded-xl px-2 py-2 text-left text-[12px] sm:grid-cols-[1fr_110px_120px] ${
                          isSelected()
                            ? 'bg-amber-500/12 ring-1 ring-inset ring-amber-500/25'
                            : 'hover:bg-slate-100/86 dark:hover:bg-slate-900/70'
                        }`}
                        onClick={() => {
                          if (e.is_dir) {
                            navigate(fullPath())
                          } else {
                            setSelectedFile(fullPath())
                          }
                        }}
                        title={fullPath()}
                      >
                        <div class="flex min-w-0 items-center gap-2">
                          <span class="text-slate-500 dark:text-slate-400" aria-hidden="true">
                            <Show
                              when={e.is_dir}
                              fallback={
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                  <path
                                    fill-rule="evenodd"
                                    d="M4.75 3A2.75 2.75 0 002 5.75v8.5A2.75 2.75 0 004.75 17h10.5A2.75 2.75 0 0018 14.25V7.45A2.75 2.75 0 0015.25 4.7h-2.994a1.25 1.25 0 01-.884-.366l-.56-.56A2.75 2.75 0 009.69 3H4.75z"
                                    clip-rule="evenodd"
                                  />
                                </svg>
                              }
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                <path d="M2 6.75A2.75 2.75 0 014.75 4h2.69c.73 0 1.429.29 1.945.806l.56.56c.214.214.504.334.806.334h4.504A2.75 2.75 0 0118 8.45v5.8A2.75 2.75 0 0115.25 17H4.75A2.75 2.75 0 012 14.25v-7.5z" />
                              </svg>
                            </Show>
                          </span>
                          <span class="truncate font-mono text-slate-900 dark:text-slate-100">{e.name}</span>
                        </div>
                        <div class="text-right font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {e.is_dir ? '—' : formatBytes(e.size_bytes)}
                        </div>
                        <div class="text-right font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          <Show when={modified()} fallback={<span>—</span>}>
                            {(m) => <span title={new Date(m()).toLocaleString()}>{formatRelativeTime(m(), props.t)}</span>}
                          </Show>
                        </div>
                      </button>
                    )
                  }}
                </For>
              </div>
            </DataBoundary>
          </div>
      </aside>

      <section class="surface-glass min-w-0 flex-1 overflow-hidden p-3 md:p-4">
        <div class="mx-auto flex h-full w-full max-w-[min(76rem,96%)] flex-col">
          <Show
            when={selectedFile()}
            fallback={
              <div class="flex flex-1 items-center justify-center">
                <EmptyState title={props.t('fileBrowser.selectFile')} description={props.t('fileBrowser.selectFileHint')} />
              </div>
            }
          >
            {(file) => (
            <div class="flex min-h-0 flex-1 flex-col gap-3">
                <div class="surface-card flex flex-wrap items-start justify-between gap-3 p-4">
                  <div class="min-w-0">
                    <div class="truncate font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{selectedFileName()}</div>
                    <div class="mt-1 truncate font-mono text-[11px] text-slate-600 dark:text-slate-300" title={file()}>
                      {file()}
                    </div>
                    <Show when={!selectedIsLog() && fileText.data}>
                      {(d) => (
                        <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                          <Badge variant="neutral">{formatBytes(d().size_bytes)}</Badge>
                          <Show when={d().size_bytes > READ_LIMIT}>
                            <Badge variant="warning">{props.t('fileBrowser.showingFirst', { size: formatBytes(READ_LIMIT) })}</Badge>
                          </Show>
                          <Badge variant="neutral">{fileLanguage()}</Badge>
                        </div>
                      )}
                    </Show>
                    <Show when={selectedIsLog()}>
                      <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                        <Badge variant="neutral">{props.t('fileBrowser.logTail')}</Badge>
                        <Show when={logTail.isPending}>
                          <Badge variant="neutral">{props.t('fileBrowser.statusLoading')}</Badge>
                        </Show>
                        <Show when={logTail.isError}>
                          <Badge variant="danger">{props.t('fileBrowser.statusError')}</Badge>
                        </Show>
                      </div>
                    </Show>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <IconButton type="button" label={props.t('fileBrowser.copyPath')} variant="secondary" onClick={() => void copyPath(file())}>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                        <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                        <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                      </svg>
                    </IconButton>
                    <Show when={!selectedIsLog()}>
                      <IconButton
                        type="button"
                        label={props.t('fileBrowser.copyFile')}
                        variant="secondary"
                        disabled={!fileText.data?.text}
                        onClick={() => void copyPreviewText()}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                          <path
                            fill-rule="evenodd"
                            d="M4.25 2A2.25 2.25 0 002 4.25v11.5A2.25 2.25 0 004.25 18h6.5A2.25 2.25 0 0013 15.75V7.5a.75.75 0 00-.22-.53l-3.75-3.75A.75.75 0 008.5 3H4.25zm5.25 2.56L11.44 6.5H9.75a.75.75 0 01-.75-.75V4.56z"
                            clip-rule="evenodd"
                          />
                        </svg>
                      </IconButton>
                    </Show>
                  </div>
                </div>

                <Show when={selectedIsLog()}>
                  <Show
                    when={!logTail.isError}
                    fallback={<ErrorState t={props.t} error={logTail.error} title={props.t('fileBrowser.errorTailLogTitle')} onRetry={() => logTail.refetch()} />}
                  >
                    <LogViewer
                      t={props.t}
                      title={props.t('fileBrowser.tailTitle')}
                      titleLevel="section"
                      lines={logLines()}
                      loading={logTail.isPending}
                      live={logLive()}
                      onLiveChange={setLogLive}
                      onClear={() => setLogLines([])}
                      onToast={props.onToast}
                      storageKey={`alloy.filelog.${file()}`}
                      class="min-h-0 flex-1"
                    />
                  </Show>
                </Show>

                <Show when={!selectedIsLog()}>
                  <Show when={fileText.isPending}>
                    <div class="surface-card p-4">
                      <Skeleton lines={8} />
                    </div>
                  </Show>

                  <Show
                    when={!fileText.isError}
                    fallback={
                      <Show
                        when={isAlloyApiError(fileText.error) && fileText.error.data.code === 'invalid_utf8'}
                        fallback={
                          <div class="space-y-3">
                            <ErrorState t={props.t} error={fileText.error} title={props.t('fileBrowser.errorReadFileTitle')} onRetry={() => fileText.refetch()} />
                            <Show when={fileErrorSuggestion(fileText.error, props.t)}>
                              {(s) => (
                                <div class="surface-card p-4 text-[12px] text-slate-700 dark:text-slate-200">
                                  <div class="text-sm font-semibold">{s().title}</div>
                                  <ul class="mt-2 list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-300">
                                    <For each={s().hints}>{(h) => <li>{h}</li>}</For>
                                  </ul>
                                </div>
                              )}
                            </Show>
                          </div>
                        }
                      >
                        <EmptyState title={props.t('fileBrowser.previewNotSupported')} />
                      </Show>
                    }
                  >
                    <Show when={fileText.data?.text != null}>
                      <div class="surface-card flex min-h-0 flex-1 flex-col overflow-hidden">
                        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/90 bg-white/74 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/56">
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
                              class="w-28"
                              placeholder={props.t('fileBrowser.lineNumber')}
                              invalid={goLineInvalid()}
                              rightIcon={
                                <button
                                  type="submit"
                                  class={cn(
                                    'ring-focus motion-surface rounded-lg p-1.5 disabled:cursor-not-allowed disabled:opacity-40',
                                    !goLineInvalid() && goLineDraft().trim()
                                      ? 'hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-900/60 dark:hover:text-slate-200'
                                      : '',
                                  )}
                                  disabled={goLineInvalid() || !goLineDraft().trim()}
                                  aria-label={props.t('fileBrowser.goToLine')}
                                  title={props.t('fileBrowser.goEnter')}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                    <path
                                      fill-rule="evenodd"
                                      d="M3 10a.75.75 0 01.75-.75h10.638L10.22 5.28a.75.75 0 111.06-1.06l5.25 5.25a.75.75 0 010 1.06l-5.25 5.25a.75.75 0 11-1.06-1.06l4.168-4.17H3.75A.75.75 0 013 10z"
                                      clip-rule="evenodd"
                                    />
                                  </svg>
                                </button>
                              }
                            />
                          </form>

                          <IconButton
                            type="button"
                            label={props.t('fileBrowser.copySelectedLine')}
                            variant="secondary"
                            disabled={selectedLineIdx() == null}
                            onClick={() => void copySelectedLine()}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                              <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                              <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                            </svg>
                          </IconButton>
                          <div class="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                            {props.t('fileBrowser.lineCount', { count: fileLines().length })}
                          </div>
                        </div>

                        <VirtualLines
                          lines={fileLines()}
                          ariaLabel={props.t('fileBrowser.linesAria')}
                          defaultAriaLabel={props.t('fileBrowser.linesAria')}
                          wrap={false}
                          showLineNumbers={true}
                          fontSize={12}
                          lineHeight={18}
                          selectedIndex={selectedLineIdx()}
                          onSelectIndex={(idx) => setSelectedLineIdx(idx)}
                          empty={<div class="p-3 text-[12px] text-slate-500">{props.t('fileBrowser.emptyFile')}</div>}
                          onScrollEl={(el) => {
                            codeScrollEl = el
                          }}
                          class="!rounded-none !border-0 !bg-transparent flex-1 min-h-0"
                          renderLine={(line) => {
                            const lang = fileLanguage()
                            if (lang === 'json') return highlightJsonLine(line)
                            if (lang === 'yaml' || lang === 'toml' || lang === 'ini') return highlightKeyValueLine(line)
                            return line
                          }}
                        />
                      </div>
                    </Show>
                  </Show>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </section>
    </div>
  )
}
