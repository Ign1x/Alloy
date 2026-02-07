import { For, Show, createMemo } from 'solid-js'
import { ArrowDown, ArrowUp, Download, Pause, Play, RotateCw, Search, Trash2, X } from 'lucide-solid'
import type { DownloadJob } from '../../app/types'
import {
  downloadJobPercent,
  downloadJobProgressMessage,
  downloadJobStatusLabel,
  downloadJobStatusVariant,
  downloadTargetLabel,
} from '../../app/helpers/downloads'
import { formatBytes, formatRelativeTime } from '../../app/helpers/format'
import { DownloadProgress } from '../../app/primitives/DownloadProgress'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { Input } from '../../components/ui/Input'
import { StatusPill, SURFACE } from './DownloadsTabUi'

export type CachedVersionRow = {
  version: string
  key: string
  path: string
  sizeBytes: number
  lastUsedUnixMs: number
  meta?: string
}

export type DownloadStatus = {
  ok: boolean
  message: string
  requestId?: string
  atUnixMs: number
}

export type VersionOption = { value: string; label: string; meta?: string }

export function JobRow(props: {
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
  const progressPercent = () => downloadJobPercent(props.job)
  const progressDownloaded = () => props.job.progressDownloadedBytes
  const progressTotal = () => props.job.progressTotalBytes
  const progressSpeed = () => props.job.progressSpeedBytesPerSec
  const progressEtaSec = () => props.job.progressEtaSec
  const showReorder = () => Boolean(props.canReorder) && (props.job.state === 'queued' || props.job.state === 'paused')

  const speedLabel = () => {
    const v = progressSpeed()
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return '—'
    return `${formatBytes(v)}/s`
  }

  const progressLabel = () => {
    const pct = progressPercent()
    if (pct == null) return 'running'
    return `${pct.toFixed(1)}%`
  }

  const progressBarWidth = () => {
    const pct = progressPercent()
    if (pct == null) return '30%'
    const clamped = Math.max(0, Math.min(100, pct))
    if (clamped > 0 && clamped < 2) return '2%'
    return `${clamped}%`
  }

  const progressBarClass = () => {
    const pct = progressPercent()
    if (pct == null) return 'animate-pulse bg-amber-400'
    if (pct < 30) return 'bg-amber-500'
    if (pct >= 90) return 'bg-emerald-400'
    return 'bg-emerald-500'
  }

  const etaLabel = () => {
    const sec = progressEtaSec()
    if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) return '—'
    if (sec < 60) return `${Math.floor(sec)}s`
    if (sec < 3600) {
      const m = Math.floor(sec / 60)
      const s = Math.floor(sec % 60)
      return `${m}m ${s}s`
    }
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    return `${h}h ${m}m`
  }

  return (
    <div class="flex flex-wrap items-start justify-between gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900/20">
      <div class="flex min-w-0 items-start gap-3">
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
            <div class="mt-2 space-y-2">
              <DownloadProgress templateId={props.job.templateId} message={progressMessage()} />
              <div class="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-[11px] dark:border-slate-800 dark:bg-slate-950/40">
                <div class="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <span>{props.job.progressStage || 'download'}</span>
                  <span class="font-mono text-slate-700 dark:text-slate-200">{progressLabel()}</span>
                </div>
                <div class="mb-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    class={`h-full rounded-full transition-all duration-300 ${progressBarClass()}`}
                    style={{ width: progressBarWidth() }}
                    aria-hidden="true"
                  />
                </div>
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600 dark:text-slate-300">
                  <span>
                    speed <span class="font-mono text-slate-800 dark:text-slate-100">{speedLabel()}</span>
                  </span>
                  <span>
                    progress{' '}
                    <span class="font-mono text-slate-800 dark:text-slate-100">
                      {progressPercent() == null ? '—' : `${progressPercent()!.toFixed(1)}%`}
                    </span>
                  </span>
                  <span>
                    size{' '}
                    <span class="font-mono text-slate-800 dark:text-slate-100">
                      {formatBytes(progressDownloaded())} / {formatBytes(progressTotal())}
                    </span>
                  </span>
                  <span>
                    eta <span class="font-mono text-slate-800 dark:text-slate-100">{etaLabel()}</span>
                  </span>
                </div>
              </div>
            </div>
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

export function VersionManager(props: {
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
    return `${cached.length} cached · ${formatBytes(cachedTotalBytes())} · latest ${lastLabel}`
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
        <div class="min-w-0">
          <div class="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">{props.title}</div>
          <div class="mt-1 text-[12px] text-slate-600 dark:text-slate-400">{props.subtitle}</div>
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
