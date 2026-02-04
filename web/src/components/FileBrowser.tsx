import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import { isAlloyApiError, rspc } from '../rspc'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
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

function formatRelativeTime(unixMs: number | null | undefined): string {
  if (!unixMs || !Number.isFinite(unixMs) || unixMs <= 0) return '—'
  const deltaMs = Date.now() - unixMs
  const sec = Math.floor(deltaMs / 1000)
  if (sec < 10) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
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
        <span class={isKey ? 'text-sky-300' : 'text-emerald-300'}>{str}</span>,
      )
    } else if (num) parts.push(<span class="text-violet-300">{num}</span>)
    else if (kw) parts.push(<span class="text-amber-300">{kw}</span>)
    else if (punc) parts.push(<span class="text-slate-400">{punc}</span>)
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
      <span class="text-sky-300">{key}</span>
      <span class="text-slate-400">{sep}</span>
      <span class="text-emerald-300">{rest}</span>
    </>
  )
}

function fileErrorSuggestion(err: unknown): { title: string; hints: string[] } | null {
  if (!isAlloyApiError(err)) return null
  const code = err.data.code
  if (code === 'not_found') {
    return { title: 'Not found', hints: ['The path may have been moved or deleted.', 'Try refreshing the directory.'] }
  }
  if (code === 'permission_denied') {
    return {
      title: 'Permission denied',
      hints: ['The agent cannot read this path with current permissions.', 'Check the agent data root and file permissions.'],
    }
  }
  if (code === 'invalid_utf8') {
    return {
      title: 'Unsupported file type',
      hints: ['Preview supports UTF‑8 text files only.', 'This is likely a binary file (zip/jar/db).'],
    }
  }
  if (code === 'invalid_param') {
    return { title: 'Invalid request', hints: ['The selected path may be a directory, not a file.', 'Try selecting a different entry.'] }
  }
  if (code === 'agent_unreachable') {
    return { title: 'Agent offline', hints: ['Open Diagnostics to confirm agent health.', 'Retry after the agent reconnects.'] }
  }
  if (code === 'timeout') {
    return { title: 'Timed out', hints: ['Retry the request.', 'If this keeps happening, the agent may be overloaded.'] }
  }
  return null
}

type FsEntry = { name: string; is_dir: boolean; size_bytes: number; modified_unix_ms?: string | number | null }

type FileSortKey = 'name' | 'size' | 'modified'

export type FileBrowserProps = {
  enabled: boolean
  title?: string
  initialPath?: string
  initialSelectedFile?: string | null
  rootPath?: string
  rootLabel?: string
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
    () => ['fs.listDir', { path: path() ? path() : null }],
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
      return mult * a.name.localeCompare(b.name)
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
    if (!p) return false
    return p.toLowerCase().endsWith('.log')
  })

  const READ_LIMIT = 256 * 1024

  const fileText = rspc.createQuery(
    () => [
      'fs.readFile',
      {
        path: selectedFile() ?? '',
        offset: 0,
        limit: READ_LIMIT,
      },
    ],
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
      enabled: props.enabled && !!selectedFile() && selectedIsLog(),
      refetchInterval: logLive() ? 1000 : false,
      refetchOnWindowFocus: false,
    }),
  )

  createEffect(() => {
    // Reset when file changes.
    selectedFile()
    setLogLive(true)
    setLogCursor(null)
    setLogLines([])
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
  let codeScrollEl: HTMLDivElement | undefined

  function jumpToLine() {
    const n = Number.parseInt(goLineDraft().trim(), 10)
    if (!Number.isFinite(n) || n <= 0) return
    const idx = n - 1
    const lh = 18
    if (codeScrollEl) codeScrollEl.scrollTop = Math.max(0, idx * lh - codeScrollEl.clientHeight * 0.25)
  }

  return (
    <div class={props.class}>
      <div class="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside class="flex w-full flex-none flex-col border-b border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-950/60 md:w-[420px] md:border-b-0 md:border-r max-h-[45vh] md:max-h-none">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/60">
            <div class="min-w-0">
              <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{props.title ?? 'Files'}</div>
              <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <Show when={lastRefreshAt()}>
                  {(t) => <span>Updated {formatRelativeTime(t())}</span>}
                </Show>
                <Show when={fsList.isPending}>
                  <span class="inline-flex items-center gap-1">
                    <span class="h-1.5 w-1.5 rounded-full bg-slate-500 animate-pulse" />
                    loading
                  </span>
                </Show>
                <Show when={fsList.isError}>
                  <span class="inline-flex items-center gap-1">
                    <span class="h-1.5 w-1.5 rounded-full bg-rose-500" />
                    error
                  </span>
                </Show>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <IconButton type="button" label="Back" variant="ghost" disabled={backStack().length === 0} onClick={() => goBack()}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                  <path
                    fill-rule="evenodd"
                    d="M11.78 15.53a.75.75 0 01-1.06 0l-5-5a.75.75 0 010-1.06l5-5a.75.75 0 111.06 1.06L7.31 10l4.47 4.47a.75.75 0 010 1.06z"
                    clip-rule="evenodd"
                  />
                </svg>
              </IconButton>
              <IconButton type="button" label="Forward" variant="ghost" disabled={forwardStack().length === 0} onClick={() => goForward()}>
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
                label="Up"
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
              <IconButton type="button" label="Refresh" variant="ghost" onClick={() => fsList.refetch()}>
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

          <div class="border-b border-slate-200 bg-white/50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">
            <div class="flex flex-wrap items-center gap-1 text-[12px] text-slate-600 dark:text-slate-300">
              <button
                type="button"
                class="rounded-lg px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-900/60"
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
                      class="rounded-lg px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-900/60"
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
              class="mt-2 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const draft = normalizePath(pathDraft())
                const root = rootPath()
                if (root && draft && !draft.startsWith(root)) navigate(`${root}/${draft}`)
                else navigate(draft)
              }}
            >
              <Input
                value={pathDraft()}
                onInput={(e) => setPathDraft(e.currentTarget.value)}
                placeholder={rootPath() ? 'Type a path (relative to this root)' : 'Type a path (relative to /data)'}
              />
              <Button size="xs" variant="secondary" type="submit">
                Go
              </Button>
            </form>
          </div>

          <div class="min-h-0 flex-1 overflow-auto p-2">
            <div class="grid grid-cols-[1fr_110px_120px] gap-1 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <button type="button" class="text-left hover:text-slate-700 dark:hover:text-slate-200" onClick={() => toggleSort('name')}>
                Name {sortKey() === 'name' ? (sortDir() === 'asc' ? '▲' : '▼') : ''}
              </button>
              <button type="button" class="text-right hover:text-slate-700 dark:hover:text-slate-200" onClick={() => toggleSort('size')}>
                Size {sortKey() === 'size' ? (sortDir() === 'asc' ? '▲' : '▼') : ''}
              </button>
              <button type="button" class="text-right hover:text-slate-700 dark:hover:text-slate-200" onClick={() => toggleSort('modified')}>
                Modified {sortKey() === 'modified' ? (sortDir() === 'asc' ? '▲' : '▼') : ''}
              </button>
            </div>

            <Show when={!fsList.isPending} fallback={<div class="p-2"><Skeleton lines={6} /></div>}>
              <Show
                when={!fsList.isError}
                fallback={<ErrorState error={fsList.error} title="Failed to list directory" onRetry={() => fsList.refetch()} />}
              >
                <Show
                  when={sortedEntries().length > 0}
                  fallback={
                    <EmptyState
                      title="Empty directory"
                      description="No files here yet."
                      actions={
                        <Button size="xs" variant="secondary" onClick={() => fsList.refetch()}>
                          Refresh
                        </Button>
                      }
                    />
                  }
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
                            class={`grid w-full grid-cols-[1fr_110px_120px] items-center gap-1 rounded-xl px-2 py-2 text-left text-[12px] transition-colors ${
                              isSelected()
                                ? 'bg-amber-500/10 ring-1 ring-inset ring-amber-500/20'
                                : 'hover:bg-slate-100 dark:hover:bg-slate-900/60'
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
                                {(m) => <span title={new Date(m()).toLocaleString()}>{formatRelativeTime(m())}</span>}
                              </Show>
                            </div>
                          </button>
                        )
                      }}
                    </For>
                  </div>
                </Show>
              </Show>
            </Show>
          </div>
        </aside>

        <section class="min-w-0 flex-1 overflow-auto bg-transparent p-4">
          <Show
            when={selectedFile()}
            fallback={
              <EmptyState
                title="Select a file"
                description="Pick a file from the left to preview its contents."
              />
            }
          >
            {(file) => (
              <div class="space-y-3">
                <div class="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                  <div class="min-w-0">
                    <div class="truncate font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{selectedFileName()}</div>
                    <div class="mt-1 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400" title={file()}>
                      {file()}
                    </div>
                    <Show when={!selectedIsLog() && fileText.data}>
                      {(d) => (
                        <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                          <Badge variant="neutral">{formatBytes(d().size_bytes)}</Badge>
                          <Show when={d().size_bytes > READ_LIMIT}>
                            <Badge variant="warning">showing first {formatBytes(READ_LIMIT)}</Badge>
                          </Show>
                          <Badge variant="neutral">{fileLanguage()}</Badge>
                        </div>
                      )}
                    </Show>
                    <Show when={selectedIsLog()}>
                      <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <Badge variant="neutral">log tail</Badge>
                        <Show when={logTail.isPending}>
                          <Badge variant="neutral">loading…</Badge>
                        </Show>
                        <Show when={logTail.isError}>
                          <Badge variant="danger">error</Badge>
                        </Show>
                      </div>
                    </Show>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <IconButton type="button" label="Copy path" variant="secondary" onClick={async () => navigator.clipboard.writeText(file())}>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                        <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                        <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                      </svg>
                    </IconButton>
                    <Show when={!selectedIsLog()}>
                      <IconButton
                        type="button"
                        label="Copy file"
                        variant="secondary"
                        disabled={!fileText.data?.text}
                        onClick={async () => navigator.clipboard.writeText(fileText.data?.text ?? '')}
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
                    fallback={<ErrorState error={logTail.error} title="Failed to tail log" onRetry={() => logTail.refetch()} />}
                  >
                    <LogViewer
                      title="Tail"
                      lines={logLines()}
                      loading={logTail.isPending}
                      live={logLive()}
                      onLiveChange={setLogLive}
                      onClear={() => setLogLines([])}
                      storageKey={`alloy.filelog.${file()}`}
                    />
                  </Show>
                </Show>

                <Show when={!selectedIsLog()}>
                  <Show when={fileText.isPending}>
                    <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
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
                            <ErrorState error={fileText.error} title="Failed to read file" onRetry={() => fileText.refetch()} />
                            <Show when={fileErrorSuggestion(fileText.error)}>
                              {(s) => (
                                <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 text-[12px] text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:shadow-none">
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
                        <EmptyState title="Preview not supported" description="This file can't be previewed." />
                      </Show>
                    }
                  >
                    <Show when={fileText.data?.text != null}>
                      <div class="flex flex-wrap items-center justify-between gap-2">
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
                            placeholder="Go to line"
                          />
                          <Button size="xs" variant="secondary" type="submit">
                            Go
                          </Button>
                        </form>
                        <div class="text-[11px] text-slate-500 dark:text-slate-400">{fileLines().length} lines</div>
                      </div>

                      <VirtualLines
                        lines={fileLines()}
                        wrap={false}
                        showLineNumbers={true}
                        fontSize={12}
                        lineHeight={18}
                        onScrollEl={(el) => {
                          codeScrollEl = el
                        }}
                        class="mt-3 !bg-slate-950 !text-slate-100 !border-slate-800"
                        renderLine={(line) => {
                          const lang = fileLanguage()
                          if (lang === 'json') return highlightJsonLine(line)
                          if (lang === 'yaml' || lang === 'toml' || lang === 'ini') return highlightKeyValueLine(line)
                          return line
                        }}
                      />
                    </Show>
                  </Show>
                </Show>
              </div>
            )}
          </Show>
        </section>
      </div>
    </div>
  )
}
