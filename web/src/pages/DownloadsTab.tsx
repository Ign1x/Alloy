import { For, Show, createMemo, createSignal, type JSX } from 'solid-js'
import { ArrowDown, ArrowUp, Download, HardDrive, Pause, Play, RotateCw, Search, Trash2, X, ListChecks } from 'lucide-solid'
import type { DownloadCenterView, DownloadJob, DownloadTarget } from '../app/types'
import { downloadJobProgressMessage, downloadJobStatusLabel, downloadJobStatusVariant, downloadTargetLabel } from '../app/helpers/downloads'
import { formatBytes, formatRelativeTime } from '../app/helpers/format'
import { instanceCardBackdrop } from '../app/helpers/instances'
import { DownloadProgress } from '../app/primitives/DownloadProgress'
import { queryClient } from '../rspc'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Field } from '../components/ui/Field'
import { IconButton } from '../components/ui/IconButton'
import { Input } from '../components/ui/Input'

export type DownloadsTabProps = {
  tab: () => string
  [key: string]: unknown
}

type CacheEntryRow = { key: string; path: string; size_bytes: string; last_used_unix_ms: string }

type CachedVersionRow = {
  version: string
  key: string
  path: string
  sizeBytes: number
  lastUsedUnixMs: number
  meta?: string
}

type DownloadStatus = {
  ok: boolean
  message: string
  requestId?: string
  atUnixMs: number
}

type VersionOption = { value: string; label: string; meta?: string }

const SURFACE =
  'rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:shadow-none'

function templateKind(templateId: string): string {
  const i = templateId.indexOf(':')
  return i >= 0 ? templateId.slice(0, i) : templateId
}

function templateLabel(templateId: string): string {
  const kind = templateKind(templateId)
  if (kind === 'minecraft') return 'Minecraft'
  if (kind === 'terraria') return 'Terraria'
  if (kind === 'dsp') return 'DSP (Nebula)'
  if (kind === 'dst') return "Don't Starve Together"
  if (kind === 'demo') return 'Demo'
  return templateId
}

function GameMark(props: { templateId: string; class?: string; title?: string }) {
  const backdrop = createMemo(() => instanceCardBackdrop(props.templateId))
  const label = createMemo(() => props.title ?? templateLabel(props.templateId))
  return (
    <Show
      when={backdrop()}
      fallback={
        <span
          class={`inline-flex h-9 w-9 items-center justify-center rounded-lg bg-slate-200 text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-200 ${props.class ?? ''}`}
        >
          {templateKind(props.templateId).slice(0, 2).toUpperCase()}
        </span>
      }
    >
      {(b) => (
        <img
          src={(b() as { src: string; position: string }).src}
          style={{ 'object-position': (b() as { src: string; position: string }).position }}
          alt={label()}
          title={label()}
          draggable={false}
          class={`h-9 w-9 rounded-lg object-cover ${props.class ?? ''}`}
        />
      )}
    </Show>
  )
}

function NavItem(props: {
  value: DownloadCenterView
  current: () => DownloadCenterView
  icon: JSX.Element
  label: string
  meta?: string
  right?: JSX.Element
  onSelect: (value: DownloadCenterView) => void
}) {
  const active = () => props.current() === props.value
  return (
    <button
      type="button"
      class={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950 ${
        active()
          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900/40'
      }`}
      onClick={() => props.onSelect(props.value)}
    >
      <div class="flex min-w-0 items-center gap-3">
        <div class={`${active() ? 'text-white dark:text-slate-900' : 'text-slate-500 dark:text-slate-400'}`}>{props.icon}</div>
        <div class="min-w-0">
          <div class="truncate font-medium">{props.label}</div>
          <Show when={props.meta}>
            <div class={`mt-0.5 truncate text-[11px] ${active() ? 'text-white/75 dark:text-slate-700' : 'text-slate-500 dark:text-slate-400'}`}>
              {props.meta}
            </div>
          </Show>
        </div>
      </div>
      <Show when={props.right}>
        <div class={active() ? 'text-white/90 dark:text-slate-700' : 'text-slate-500 dark:text-slate-400'}>{props.right}</div>
      </Show>
    </button>
  )
}

function StatusPill(props: { ok: boolean; children: JSX.Element }) {
  return (
    <span
      class={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${
        props.ok
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200'
          : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200'
      }`}
    >
      {props.children}
    </span>
  )
}

function Section(props: { title: string; description?: string; right?: JSX.Element; children: JSX.Element }) {
  return (
    <section class={SURFACE}>
      <div class="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">{props.title}</div>
            <Show when={props.description}>
              <div class="mt-1 text-[12px] text-slate-600 dark:text-slate-400">{props.description}</div>
            </Show>
          </div>
          <Show when={props.right}>
            <div class="flex flex-wrap items-center gap-2">{props.right}</div>
          </Show>
        </div>
      </div>
      <div class="p-4">{props.children}</div>
    </section>
  )
}

function JobRow(props: {
  job: DownloadJob
  nowUnixMs: () => number
  compact?: boolean
  canReorder?: boolean
  onMoveJob: (id: string, delta: number) => void
  onPauseJob: (id: string) => void
  onResumeJob: (id: string) => void
  onCancelJob: (id: string) => void
  onRetryJob: (id: string) => void
  onOpenDetails: (id: string) => void
}) {
  const progressMessage = () => downloadJobProgressMessage(props.job, props.nowUnixMs())
  const showReorder = () => Boolean(props.canReorder) && (props.job.state === 'queued' || props.job.state === 'paused')

  return (
    <div class="flex flex-wrap items-start justify-between gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900/20">
      <div class="flex min-w-0 items-start gap-3">
        <GameMark templateId={props.job.templateId} class={props.compact ? 'h-8 w-8' : undefined} />
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <div class="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              {downloadTargetLabel(props.job.target)}
            </div>
            <span class="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
              {props.job.version}
            </span>
            <Badge variant={downloadJobStatusVariant(props.job.state)}>{downloadJobStatusLabel(props.job.state)}</Badge>
            <Show when={props.job.requestId && !props.compact}>
              {(req) => <span class="font-mono text-[11px] text-slate-400 dark:text-slate-500">req {req()}</span>}
            </Show>
          </div>

          <Show
            when={props.job.state === 'running'}
            fallback={<div class="mt-1 text-[12px] text-slate-600 dark:text-slate-300">{props.job.message}</div>}
          >
            <DownloadProgress templateId={props.job.templateId} message={progressMessage()} />
          </Show>

          <div class="mt-1 font-mono text-[11px] text-slate-400 dark:text-slate-500">
            {formatRelativeTime(props.job.updatedAtUnixMs)}
          </div>
        </div>
      </div>

      <div class="flex flex-none items-center gap-1">
        <Button size="xs" variant="secondary" onClick={() => props.onOpenDetails(props.job.id)}>
          Details
        </Button>

        <Show when={showReorder()}>
          <>
            <IconButton label="Move up" variant="ghost" onClick={() => void props.onMoveJob(props.job.id, -1)}>
              <ArrowUp class="h-4 w-4" aria-hidden="true" />
            </IconButton>
            <IconButton label="Move down" variant="ghost" onClick={() => void props.onMoveJob(props.job.id, 1)}>
              <ArrowDown class="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </>
        </Show>

        <Show when={props.job.state === 'queued'}>
          <IconButton label="Pause" variant="secondary" onClick={() => void props.onPauseJob(props.job.id)}>
            <Pause class="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </Show>
        <Show when={props.job.state === 'paused'}>
          <IconButton label="Resume" variant="secondary" onClick={() => void props.onResumeJob(props.job.id)}>
            <Play class="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </Show>
        <Show when={props.job.state === 'queued' || props.job.state === 'paused'}>
          <IconButton label="Cancel" variant="danger" onClick={() => void props.onCancelJob(props.job.id)}>
            <X class="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </Show>
        <Show when={props.job.state === 'error' || props.job.state === 'success' || props.job.state === 'canceled'}>
          <IconButton label="Retry" variant="secondary" onClick={() => void props.onRetryJob(props.job.id)}>
            <RotateCw class="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </Show>
      </div>
    </div>
  )
}

function VersionManager(props: {
  title: string
  subtitle: string
  templateId: string
  aggregateCacheKey: string
  cachedVersions: () => CachedVersionRow[]
  status: () => DownloadStatus | null
  options: () => VersionOption[]
  search: () => string
  setSearch: (v: string) => void
  value: () => string
  onSelect: (v: string) => void
  onInstall: () => void
  installPending: () => boolean
  installDisabled: () => boolean
  deleteDisabled: () => boolean
  deletingKey: () => string | null
  onDeleteCacheKey: (key: string, label: string) => void
}) {
  const cachedByVersion = createMemo(() => {
    const map = new Map<string, CachedVersionRow>()
    for (const row of props.cachedVersions()) map.set(row.version, row)
    return map
  })

  const labelByValue = createMemo(() => {
    const map = new Map<string, string>()
    for (const opt of props.options()) map.set(opt.value, opt.label)
    return map
  })

  const filtered = createMemo(() => {
    const q = props.search().trim().toLowerCase()
    const opts = props.options()
    if (!q) return opts
    return opts.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
  })

  const cachedTotalBytes = createMemo(() => props.cachedVersions().reduce((sum, row) => sum + row.sizeBytes, 0))

  const cachedSummary = createMemo(() => {
    const cached = props.cachedVersions()
    if (cached.length === 0) return 'Not cached'
    const last = cached[0]
    const lastLabel = labelByValue().get(last.version) ?? last.version
    return `${cached.length} cached · ${formatBytes(cachedTotalBytes())} · last ${lastLabel}`
  })

  const selectedLabel = createMemo(() => labelByValue().get(props.value()) ?? props.value())
  const selectedCache = createMemo(() => cachedByVersion().get(props.value()) ?? null)
  const selectedCachedMessage = createMemo(() => {
    const row = selectedCache()
    if (!row) return null
    const parts = [`${formatBytes(row.sizeBytes)}`, formatRelativeTime(row.lastUsedUnixMs)]
    if (row.meta) parts.unshift(row.meta)
    return parts.filter(Boolean).join(' · ')
  })

  return (
    <div class="space-y-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex min-w-0 items-start gap-3">
          <GameMark templateId={props.templateId} class="mt-0.5" />
          <div class="min-w-0">
            <div class="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">{props.title}</div>
            <div class="mt-1 text-[12px] text-slate-600 dark:text-slate-400">{props.subtitle}</div>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Badge variant={props.cachedVersions().length > 0 ? 'success' : 'neutral'}>{props.cachedVersions().length > 0 ? 'Cached' : 'Missing'}</Badge>
          <span class="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
            {cachedSummary()}
          </span>
        </div>
      </div>

      <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section class={SURFACE}>
          <div class="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">Versions</div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400">{filtered().length} shown</div>
            </div>
            <div class="mt-3">
              <Input
                value={props.search()}
                onInput={(e) => props.setSearch(e.currentTarget.value)}
                placeholder="Search versions…"
                class="w-full"
                leftIcon={<Search class="h-4 w-4" aria-hidden="true" />}
              />
            </div>
          </div>

          <div class="max-h-[60vh] overflow-auto">
            <Show
              when={filtered().length > 0}
              fallback={<EmptyState title="No matching versions" description="Try a different search term." class="m-4" />}
            >
              <div class="divide-y divide-slate-200 dark:divide-slate-800">
                <For each={filtered()}>
                  {(opt) => {
                    const selected = () => opt.value === props.value()
                    const cached = () => cachedByVersion().get(opt.value) ?? null

                    return (
                      <button
                        type="button"
                        class={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                          selected()
                            ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-900/20'
                        }`}
                        onClick={() => props.onSelect(opt.value)}
                      >
                        <div class="min-w-0">
                          <div class="truncate text-sm font-medium">{opt.label}</div>
                          <Show when={opt.meta || cached()}>
                            <div
                              class={`mt-0.5 flex flex-wrap items-center gap-2 text-[11px] ${
                                selected() ? 'text-white/75 dark:text-slate-700' : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              <Show when={opt.meta}>
                                <span>{opt.meta}</span>
                              </Show>
                              <Show when={opt.meta && cached()}>
                                <span>·</span>
                              </Show>
                              <Show when={cached()}>
                                {(c) => (
                                  <span>
                                    cached {formatBytes((c() as CachedVersionRow).sizeBytes)} ·{' '}
                                    {formatRelativeTime((c() as CachedVersionRow).lastUsedUnixMs)}
                                  </span>
                                )}
                              </Show>
                            </div>
                          </Show>
                        </div>
                        <div class="flex flex-none items-center gap-2">
                          <Show when={cached()}>
                            <StatusPill ok>cached</StatusPill>
                          </Show>
                          <Show when={selected() && !cached()}>
                            <span class={`text-[11px] ${selected() ? 'text-white/85 dark:text-slate-700' : 'text-slate-500 dark:text-slate-400'}`}>selected</span>
                          </Show>
                        </div>
                      </button>
                    )
                  }}
                </For>
              </div>
            </Show>
          </div>
        </section>

        <section class={SURFACE}>
          <div class="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
            <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">Manage</div>
            <div class="mt-1 text-[12px] text-slate-600 dark:text-slate-400">
              Cache multiple versions side-by-side. Instances can reference any cached version.
            </div>
          </div>
          <div class="space-y-4 p-4">
            <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/20">
              <div class="text-[11px] font-medium text-slate-600 dark:text-slate-400">Selected</div>
              <div class="mt-1 truncate font-mono text-[12px] text-slate-900 dark:text-slate-100" title={selectedLabel()}>
                {selectedLabel()}
              </div>
              <Show when={selectedCache()}>
                <div class="mt-2 text-[12px] text-emerald-700 dark:text-emerald-300">{selectedCachedMessage()}</div>
              </Show>
            </div>

            <div class="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="primary"
                leftIcon={<Download class="h-4 w-4" aria-hidden="true" />}
                loading={props.installPending()}
                disabled={props.installDisabled()}
                onClick={props.onInstall}
              >
                Cache version
              </Button>

              <Show when={selectedCache()}>
                {(row) => (
                  <Button
                    size="sm"
                    variant="danger"
                    leftIcon={<Trash2 class="h-4 w-4" aria-hidden="true" />}
                    loading={props.deletingKey() === (row() as CachedVersionRow).key}
                    disabled={props.deleteDisabled()}
                    onClick={() => props.onDeleteCacheKey((row() as CachedVersionRow).key, `${props.title} ${selectedLabel()}`)}
                  >
                    Delete
                  </Button>
                )}
              </Show>
            </div>

            <Show when={props.cachedVersions().length > 0}>
              <div>
                <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Cached versions</div>
                <div class="mt-2 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
                  <div class="divide-y divide-slate-200 dark:divide-slate-800">
                    <For each={props.cachedVersions()}>
                      {(row) => (
                        <div class="flex flex-wrap items-center justify-between gap-3 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-900/20">
                          <button
                            type="button"
                            class="min-w-0 text-left"
                            onClick={() => props.onSelect(row.version)}
                            title="Select version"
                          >
                            <div class="truncate font-mono text-[12px] text-slate-900 dark:text-slate-100">
                              {labelByValue().get(row.version) ?? row.version}
                            </div>
                            <div class="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              <Show when={row.meta}>
                                <span>{row.meta}</span>
                              </Show>
                              <span>{formatBytes(row.sizeBytes)}</span>
                              <span>·</span>
                              <span title={new Date(row.lastUsedUnixMs).toLocaleString()}>{formatRelativeTime(row.lastUsedUnixMs)}</span>
                            </div>
                          </button>
                          <Button
                            size="xs"
                            variant="danger"
                            leftIcon={<Trash2 class="h-4 w-4" aria-hidden="true" />}
                            loading={props.deletingKey() === row.key}
                            disabled={props.deleteDisabled()}
                            onClick={() => props.onDeleteCacheKey(row.key, `${props.title} ${labelByValue().get(row.version) ?? row.version}`)}
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                    </For>
                  </div>
                </div>

                <div class="mt-3">
                  <Button
                    size="xs"
                    variant="danger"
                    leftIcon={<Trash2 class="h-4 w-4" aria-hidden="true" />}
                    loading={props.deletingKey() === props.aggregateCacheKey}
                    disabled={props.deleteDisabled()}
                    onClick={() => props.onDeleteCacheKey(props.aggregateCacheKey, `${props.title} (all cached versions)`)}
                  >
                    Delete all cached
                  </Button>
                </div>
              </div>
            </Show>

            <Show when={props.status()}>
              {(s) => (
                <div class="rounded-xl border border-slate-200 bg-white p-3 text-[12px] dark:border-slate-800 dark:bg-slate-950">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="text-sm font-medium text-slate-900 dark:text-slate-100">Last result</div>
                    <StatusPill ok={(s() as DownloadStatus).ok}>{(s() as DownloadStatus).ok ? 'ok' : 'failed'}</StatusPill>
                  </div>
                  <div class="mt-2 text-slate-700 dark:text-slate-200">{(s() as DownloadStatus).message}</div>
                  <div class="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    <span>{formatRelativeTime((s() as DownloadStatus).atUnixMs)}</span>
                    <Show when={(s() as DownloadStatus).requestId}>
                      {(req) => <span>req {req()}</span>}
                    </Show>
                  </div>
                </div>
              )}
            </Show>
          </div>
        </section>
      </div>
    </div>
  )
}

export default function DownloadsTab(props: DownloadsTabProps) {
  const {
    tab,
    hasRunningDownloadJobs,
    downloadQueuePaused,
    downloadJobs,
    downloadCenterView,
    setDownloadCenterView,
    toggleDownloadQueuePaused,
    clearDownloadHistory,
    moveDownloadJob,
    pauseDownloadJob,
    resumeDownloadJob,
    cancelDownloadJob,
    retryDownloadJob,
    setSelectedDownloadJobId,
    enqueueDownloadWarm,
    downloadNowUnixMs,
    isReadOnly,
    downloadEnqueueTarget,
    downloadStatus,
    controlDiagnostics,
    clearCache,
    pushToast,
    toastError,
    downloadMcVersion,
    setDownloadMcVersion,
    mcVersionOptions,
    downloadTrVersion,
    setDownloadTrVersion,
    trVersionOptions,
    downloadDspGuardCode,
    setDownloadDspGuardCode,
    hasSavedSteamcmdCreds,
    setTab,
    downloadQueueEnqueue,
  } = props as any

  const view = downloadCenterView as () => DownloadCenterView
  const setView = setDownloadCenterView as (v: DownloadCenterView) => void

  const statusByTarget = createMemo(() => {
    const raw = downloadStatus() as Map<DownloadTarget, DownloadStatus>
    const map = new Map<DownloadTarget, DownloadStatus>()
    for (const [k, v] of raw.entries()) map.set(k, v)
    return map
  })
  const status = (target: DownloadTarget) => statusByTarget().get(target) ?? null

  const jobs = createMemo(() => (downloadJobs() as DownloadJob[]) ?? [])
  const activeJobs = createMemo(() => jobs().filter((j) => j.state === 'queued' || j.state === 'running' || j.state === 'paused'))
  const historyJobs = createMemo(() => jobs().filter((j) => j.state === 'success' || j.state === 'error' || j.state === 'canceled'))

  const counts = createMemo(() => ({
    active: activeJobs().length,
    running: activeJobs().filter((j) => j.state === 'running').length,
    paused: activeJobs().filter((j) => j.state === 'paused').length,
    queued: activeJobs().filter((j) => j.state === 'queued').length,
    history: historyJobs().length,
  }))

  const cacheEntries = createMemo(() => (controlDiagnostics.data?.cache?.entries ?? []) as CacheEntryRow[])
  const cacheTotalBytes = createMemo(() => cacheEntries().reduce((sum, e) => sum + Number(e.size_bytes ?? 0), 0))

  function parseMinecraftCacheKey(key: string): { version: string; sha1: string } | null {
    if (!key.startsWith('minecraft:vanilla@')) return null
    const rest = key.slice('minecraft:vanilla@'.length)
    const idx = rest.lastIndexOf('#')
    if (idx <= 0) return null
    const version = rest.slice(0, idx)
    const sha1 = rest.slice(idx + 1)
    if (!sha1 || sha1.length !== 40) return null
    return { version, sha1 }
  }

  const mcCachedVersions = createMemo(() => {
    const out: CachedVersionRow[] = []
    for (const e of cacheEntries()) {
      const parsed = parseMinecraftCacheKey(e.key)
      if (!parsed) continue
      out.push({
        version: parsed.version,
        key: e.key,
        path: e.path,
        sizeBytes: Number(e.size_bytes ?? 0),
        lastUsedUnixMs: Number(e.last_used_unix_ms ?? 0),
        meta: `sha1 ${parsed.sha1.slice(0, 8)}`,
      })
    }
    out.sort((a, b) => b.lastUsedUnixMs - a.lastUsedUnixMs || a.version.localeCompare(b.version))
    return out
  })

  const trCachedVersions = createMemo(() => {
    const out: CachedVersionRow[] = []
    for (const e of cacheEntries()) {
      if (!e.key.startsWith('terraria:vanilla@')) continue
      const version = e.key.slice('terraria:vanilla@'.length)
      if (!version) continue
      out.push({
        version,
        key: e.key,
        path: e.path,
        sizeBytes: Number(e.size_bytes ?? 0),
        lastUsedUnixMs: Number(e.last_used_unix_ms ?? 0),
      })
    }
    out.sort((a, b) => b.lastUsedUnixMs - a.lastUsedUnixMs || a.version.localeCompare(b.version))
    return out
  })

  const dspSourceCache = createMemo(() => cacheEntries().find((e) => e.key === 'dsp:nebula@source') ?? null)
  const dspSourceBytes = createMemo(() => Number(dspSourceCache()?.size_bytes ?? 0))
  const dspSourceLastUsed = createMemo(() => Number(dspSourceCache()?.last_used_unix_ms ?? 0))
  const dspCached = createMemo(() => dspSourceBytes() > 0)

  const [deletingKey, setDeletingKey] = createSignal<string | null>(null)
  const deleteDisabled = createMemo(() => isReadOnly() || Boolean(clearCache.isPending) || Boolean(deletingKey()))

  async function deleteCacheKey(key: string, label: string) {
    if (isReadOnly()) return
    const ok = window.confirm(`Delete cached data for ${label}?\n\nThis only removes downloaded server files on this node.`)
    if (!ok) return
    try {
      setDeletingKey(key)
      const out = await clearCache.mutateAsync({ keys: [key] })
      pushToast('success', 'Deleted', `Freed ${formatBytes(Number(out.freed_bytes))}`)
      await queryClient.invalidateQueries({ queryKey: ['control.diagnostics', null] })
      await queryClient.invalidateQueries({ queryKey: ['process.cacheStats', null] })
    } catch (e) {
      toastError('Delete failed', e)
    } finally {
      setDeletingKey(null)
    }
  }

  const [cacheSearch, setCacheSearch] = createSignal('')
  const filteredCache = createMemo(() => {
    const q = cacheSearch().trim().toLowerCase()
    const list = cacheEntries()
    if (!q) return list
    return list.filter((e) => e.key.toLowerCase().includes(q) || e.path.toLowerCase().includes(q))
  })

  const [mcSearch, setMcSearch] = createSignal('')
  const [trSearch, setTrSearch] = createSignal('')

  const installPending = createMemo(() => Boolean(downloadQueueEnqueue.isPending))
  const installTarget = downloadEnqueueTarget as () => DownloadTarget | null

  return (
    <Show when={tab() === 'downloads'}>
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <aside class="flex w-full flex-none flex-col border-b border-slate-200 bg-white/60 p-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/60 md:w-[264px] md:border-b-0 md:border-r">
          <div class="px-2 py-2">
            <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">Downloads</div>
            <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Manage versions and download tasks per node.
            </div>
          </div>

          <nav class="mt-2 space-y-1">
            <NavItem
              value="tasks"
              current={view}
              onSelect={setView}
              icon={<ListChecks class="h-4 w-4" aria-hidden="true" />}
              label="Tasks"
              meta={counts().active > 0 ? `${counts().running} running · ${counts().queued} queued` : 'No active tasks'}
              right={
                counts().active > 0 ? (
                  <span class="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] text-white dark:bg-slate-100 dark:text-slate-900">
                    {counts().active}
                  </span>
                ) : undefined
              }
            />

            <NavItem
              value="minecraft"
              current={view}
              onSelect={setView}
              icon={<GameMark templateId="minecraft:vanilla" class="h-7 w-7" />}
              label="Minecraft"
              meta={
                mcCachedVersions().length > 0
                  ? `${mcCachedVersions().length} cached · last ${mcCachedVersions()[0]?.version ?? ''}`.trim()
                  : 'Not cached'
              }
            />
            <NavItem
              value="terraria"
              current={view}
              onSelect={setView}
              icon={<GameMark templateId="terraria:vanilla" class="h-7 w-7" />}
              label="Terraria"
              meta={
                trCachedVersions().length > 0
                  ? `${trCachedVersions().length} cached · last ${trCachedVersions()[0]?.version ?? ''}`.trim()
                  : 'Not cached'
              }
            />
            <NavItem
              value="dsp"
              current={view}
              onSelect={setView}
              icon={<GameMark templateId="dsp:nebula" class="h-7 w-7" />}
              label="DSP (Nebula)"
              meta={
                hasSavedSteamcmdCreds()
                  ? dspCached()
                    ? `cached ${formatBytes(dspSourceBytes())}`
                    : 'SteamCMD configured'
                  : 'SteamCMD required'
              }
            />

            <NavItem
              value="cache"
              current={view}
              onSelect={setView}
              icon={<HardDrive class="h-4 w-4" aria-hidden="true" />}
              label="Cache"
              meta={`${cacheEntries().length} entries · ${formatBytes(cacheTotalBytes())}`}
            />
          </nav>

          <div class="mt-auto px-2 pt-3 text-[11px] text-slate-500 dark:text-slate-400">
            Tip: If Create returns HTTP 504, downloads may still continue in the background. Queue versions here first.
          </div>
        </aside>

        <main class="min-w-0 flex-1 overflow-auto p-4">
          <div class="mx-auto w-full max-w-6xl">
            <Show when={view() === 'tasks'}>
              <div class="space-y-4">
                <Section
                  title="Tasks"
                  description="Download queue and history. Reorder, pause, retry, and inspect job details."
                  right={
                    <>
                      <Badge variant={hasRunningDownloadJobs() ? 'warning' : 'neutral'}>
                        {hasRunningDownloadJobs() ? 'Running' : 'Idle'}
                      </Badge>
                      <Show when={downloadQueuePaused()}>
                        <Badge variant="warning">Queue paused</Badge>
                      </Show>
                      <Button
                        size="xs"
                        variant="secondary"
                        leftIcon={downloadQueuePaused() ? <Play class="h-4 w-4" aria-hidden="true" /> : <Pause class="h-4 w-4" aria-hidden="true" />}
                        onClick={() => void toggleDownloadQueuePaused()}
                      >
                        {downloadQueuePaused() ? 'Resume' : 'Pause'}
                      </Button>
                      <Button
                        size="xs"
                        variant="secondary"
                        leftIcon={<Trash2 class="h-4 w-4" aria-hidden="true" />}
                        disabled={hasRunningDownloadJobs() || jobs().length === 0}
                        onClick={() => void clearDownloadHistory()}
                        title={hasRunningDownloadJobs() ? 'Stop running jobs before clearing history' : 'Clear finished jobs'}
                      >
                        Clear history
                      </Button>
                    </>
                  }
                >
                  <Show
                    when={activeJobs().length > 0}
                    fallback={
                      <EmptyState
                        title="No active tasks"
                        description="Pick a version in Minecraft/Terraria or run DSP update to start downloading."
                      />
                    }
                  >
                    <div class="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
                      <div class="divide-y divide-slate-200 dark:divide-slate-800">
                        <For each={activeJobs()}>
                          {(job) => (
                            <JobRow
                              job={job}
                              nowUnixMs={downloadNowUnixMs}
                              canReorder
                              onMoveJob={moveDownloadJob}
                              onPauseJob={pauseDownloadJob}
                              onResumeJob={resumeDownloadJob}
                              onCancelJob={cancelDownloadJob}
                              onRetryJob={retryDownloadJob}
                              onOpenDetails={(id) => setSelectedDownloadJobId(id)}
                            />
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  <Show when={historyJobs().length > 0}>
                    <details class="mt-4 rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
                      <summary class="cursor-pointer select-none px-4 py-3 text-sm font-medium text-slate-900 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-900/20">
                        History ({historyJobs().length})
                      </summary>
                      <div class="divide-y divide-slate-200 dark:divide-slate-800">
                        <For each={historyJobs()}>
                          {(job) => (
                            <JobRow
                              job={job}
                              nowUnixMs={downloadNowUnixMs}
                              compact
                              onMoveJob={moveDownloadJob}
                              onPauseJob={pauseDownloadJob}
                              onResumeJob={resumeDownloadJob}
                              onCancelJob={cancelDownloadJob}
                              onRetryJob={retryDownloadJob}
                              onOpenDetails={(id) => setSelectedDownloadJobId(id)}
                            />
                          )}
                        </For>
                      </div>
                    </details>
                  </Show>
                </Section>
              </div>
            </Show>

            <Show when={view() === 'minecraft'}>
              <VersionManager
                title="Minecraft"
                subtitle="Minecraft server bundles are version-managed (not “updated”). Cache the version you plan to use."
                templateId="minecraft:vanilla"
                aggregateCacheKey="minecraft:vanilla"
                cachedVersions={mcCachedVersions}
                status={() => status('minecraft_vanilla')}
                options={() => (mcVersionOptions() as VersionOption[]) ?? []}
                search={mcSearch}
                setSearch={setMcSearch}
                value={downloadMcVersion}
                onSelect={setDownloadMcVersion}
                onInstall={() => void enqueueDownloadWarm('minecraft_vanilla')}
                installPending={() => installPending() && installTarget() === 'minecraft_vanilla'}
                installDisabled={() => isReadOnly()}
                deleteDisabled={deleteDisabled}
                deletingKey={deletingKey}
                onDeleteCacheKey={(key, label) => void deleteCacheKey(key, label)}
              />
            </Show>

            <Show when={view() === 'terraria'}>
              <VersionManager
                title="Terraria"
                subtitle="Terraria server bundles are version-managed. Choose a build number and cache it."
                templateId="terraria:vanilla"
                aggregateCacheKey="terraria:vanilla"
                cachedVersions={trCachedVersions}
                status={() => status('terraria_vanilla')}
                options={() => (trVersionOptions() as VersionOption[]) ?? []}
                search={trSearch}
                setSearch={setTrSearch}
                value={downloadTrVersion}
                onSelect={setDownloadTrVersion}
                onInstall={() => void enqueueDownloadWarm('terraria_vanilla')}
                installPending={() => installPending() && installTarget() === 'terraria_vanilla'}
                installDisabled={() => isReadOnly()}
                deleteDisabled={deleteDisabled}
                deletingKey={deletingKey}
                onDeleteCacheKey={(key, label) => void deleteCacheKey(key, label)}
              />
            </Show>

            <Show when={view() === 'dsp'}>
              <div class="space-y-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">DSP (Nebula)</div>
                    <div class="mt-1 text-[12px] text-slate-600 dark:text-slate-400">
                      DSP uses SteamCMD and behaves like an updatable app. Running it again pulls the latest files.
                    </div>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <Badge variant={hasSavedSteamcmdCreds() ? 'success' : 'warning'}>
                      {hasSavedSteamcmdCreds() ? 'SteamCMD ready' : 'SteamCMD required'}
                    </Badge>
                    <Badge variant={dspCached() ? 'success' : 'neutral'}>{dspCached() ? 'Cached' : 'Missing'}</Badge>
                  </div>
                </div>

                <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                  <Section
                    title="SteamCMD"
                    description="Steam credentials are configured globally in Settings."
                    right={
                      <Button size="xs" variant="secondary" onClick={() => setTab('settings')}>
                        Open Settings
                      </Button>
                    }
                  >
                    <Show
                      when={hasSavedSteamcmdCreds()}
                      fallback={
                        <div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
                          SteamCMD credentials are missing. Add username/password in Settings to enable DSP downloads.
                        </div>
                      }
                    >
                      <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[12px] text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-100">
                        SteamCMD is configured. You can run updates anytime.
                      </div>
                    </Show>
                  </Section>

                  <Section title="Update" description="Re-download and install the latest DSP server files to this node.">
                    <div class="space-y-3">
                      <Field label="Steam Guard code (optional)" description="Only needed when Auto 2FA is unavailable.">
                        <Input
                          value={downloadDspGuardCode()}
                          onInput={(e) => setDownloadDspGuardCode(e.currentTarget.value)}
                          placeholder="12345"
                          autocomplete="one-time-code"
                          class="font-mono text-[11px]"
                        />
                      </Field>

                      <Button
                        size="sm"
                        variant="primary"
                        leftIcon={<RotateCw class="h-4 w-4" aria-hidden="true" />}
                        loading={installPending() && installTarget() === 'dsp_nebula'}
                        disabled={isReadOnly()}
                        onClick={() => void enqueueDownloadWarm('dsp_nebula')}
                      >
                        Update now
                      </Button>

                      <Show when={status('dsp_nebula')}>
                        {(s) => (
                          <div class="rounded-xl border border-slate-200 bg-white p-3 text-[12px] dark:border-slate-800 dark:bg-slate-950">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                              <div class="text-sm font-medium text-slate-900 dark:text-slate-100">Last result</div>
                              <StatusPill ok={(s() as DownloadStatus).ok}>
                                {(s() as DownloadStatus).ok ? 'ok' : 'failed'}
                              </StatusPill>
                            </div>
                            <div class="mt-2 text-slate-700 dark:text-slate-200">{(s() as DownloadStatus).message}</div>
                            <div class="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              <span>{formatRelativeTime((s() as DownloadStatus).atUnixMs)}</span>
                              <Show when={(s() as DownloadStatus).requestId}>
                                {(req) => <span>req {req()}</span>}
                              </Show>
                            </div>
                          </div>
                        )}
                      </Show>
                    </div>
                  </Section>
                </div>

                <Section
                  title="Storage"
                  description="Deletes only downloaded DSP server files. Instance saves live inside each instance directory."
                >
                  <div class="space-y-3">
                    <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/20">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="text-sm font-medium text-slate-900 dark:text-slate-100">Source root</div>
                        <StatusPill ok={dspCached()}>{dspCached() ? 'cached' : 'missing'}</StatusPill>
                      </div>
                      <div
                        class="mt-2 truncate font-mono text-[11px] text-slate-600 dark:text-slate-400"
                        title={dspSourceCache()?.path ?? ''}
                      >
                        {dspSourceCache()?.path ?? 'unknown'}
                      </div>
                      <div class="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        <span>{formatBytes(dspSourceBytes())}</span>
                        <span>·</span>
                        <span title={new Date(dspSourceLastUsed()).toLocaleString()}>{formatRelativeTime(dspSourceLastUsed())}</span>
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant="danger"
                      leftIcon={<Trash2 class="h-4 w-4" aria-hidden="true" />}
                      loading={deletingKey() === 'dsp:nebula@source'}
                      disabled={deleteDisabled()}
                      onClick={() => void deleteCacheKey('dsp:nebula@source', 'DSP server files')}
                    >
                      Delete server files
                    </Button>
                  </div>
                </Section>
              </div>
            </Show>

            <Show when={view() === 'cache'}>
              <div class="space-y-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">Cache</div>
                    <div class="mt-1 text-[12px] text-slate-600 dark:text-slate-400">
                      Diagnostic view of cached bundles on this node.
                    </div>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                      {cacheEntries().length} entries
                    </span>
                    <span class="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                      {formatBytes(cacheTotalBytes())}
                    </span>
                  </div>
                </div>

                <section class={SURFACE}>
                  <div class="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
                    <Input
                      value={cacheSearch()}
                      onInput={(e) => setCacheSearch(e.currentTarget.value)}
                      placeholder="Search by key or path…"
                      leftIcon={<Search class="h-4 w-4" aria-hidden="true" />}
                    />
                    <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                      Showing {filteredCache().length}/{cacheEntries().length}
                    </div>
                  </div>

                  <Show
                    when={filteredCache().length > 0}
                    fallback={<EmptyState title="No cache entries" description="Queue a version to populate the cache." class="m-4" />}
                  >
                    <div class="divide-y divide-slate-200 dark:divide-slate-800">
                      <For each={filteredCache()}>
                        {(e) => (
                          <div class="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900/20">
                            <div class="flex flex-wrap items-start justify-between gap-2">
                              <div class="min-w-0">
                                <div class="truncate font-mono text-[12px] text-slate-900 dark:text-slate-100" title={e.key}>
                                  {e.key}
                                </div>
                                <div class="mt-1 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400" title={e.path}>
                                  {e.path}
                                </div>
                              </div>
                              <div class="flex flex-none items-center gap-2">
                                <div class="flex flex-col items-end gap-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                  <div>{formatBytes(Number(e.size_bytes))}</div>
                                  <div title={e.last_used_unix_ms}>{formatRelativeTime(Number(e.last_used_unix_ms))}</div>
                                </div>
                                <IconButton
                                  label="Delete cache entry"
                                  variant="danger"
                                  disabled={deleteDisabled()}
                                  onClick={() => void deleteCacheKey(e.key, e.key)}
                                >
                                  <Show
                                    when={deletingKey() === e.key}
                                    fallback={<Trash2 class="h-4 w-4" aria-hidden="true" />}
                                  >
                                    <RotateCw class="h-4 w-4 animate-spin" aria-hidden="true" />
                                  </Show>
                                </IconButton>
                              </div>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </section>
              </div>
            </Show>
          </div>
        </main>
      </div>
    </Show>
  )
}
