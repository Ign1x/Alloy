import { For, Show, createMemo, createSignal } from 'solid-js'
import { HardDrive, Pause, Play, RotateCw, Search, Trash2, ListChecks } from 'lucide-solid'
import type { DownloadCenterView, DownloadJob, DownloadTarget } from '../app/types'
import { formatBytes, formatRelativeTime } from '../app/helpers/format'
import { templateDisplayLabel, templateLogoSrc } from '../app/helpers/templateBrand'
import { queryClient } from '../rspc'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { GameAvatar } from '../components/ui/GameAvatar'
import { IconButton } from '../components/ui/IconButton'
import { Input } from '../components/ui/Input'
import { NavItem, Section, SURFACE } from './downloads/DownloadsTabUi'
import { JobRow, VersionManager, type CachedVersionRow, type DownloadStatus, type VersionOption } from './downloads/DownloadsTabSections'

export type DownloadsTabProps = {
  tab: () => string
  [key: string]: unknown
}

type CacheEntryRow = { key: string; path: string; size_bytes: string; last_used_unix_ms: string }

type CacheDisplayRow = {
  groupId: 'minecraft' | 'terraria' | 'other'
  kind: 'aggregate' | 'version' | 'source' | 'marker' | 'other'
  title: string
  meta?: string
  key: string
  path: string
  sizeBytes: number
  lastUsedUnixMs: number
  version?: string
}


const VERSION_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

function compareVersionDesc(a: string, b: string): number {
  const av = a.trim().toLowerCase()
  const bv = b.trim().toLowerCase()
  const aUnknown = !av || av === 'unknown'
  const bUnknown = !bv || bv === 'unknown'
  if (aUnknown && bUnknown) return 0
  if (aUnknown) return 1
  if (bUnknown) return -1
  return VERSION_COLLATOR.compare(bv, av)
}

function groupTitle(groupId: CacheDisplayRow['groupId']): string {
  if (groupId === 'minecraft') return 'Minecraft'
  if (groupId === 'terraria') return 'Terraria'
  return 'Other'
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
    out.sort((a, b) => compareVersionDesc(a.version, b.version) || b.lastUsedUnixMs - a.lastUsedUnixMs)
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
    out.sort((a, b) => compareVersionDesc(a.version, b.version) || b.lastUsedUnixMs - a.lastUsedUnixMs)
    return out
  })


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
  const cacheDisplayRows = createMemo(() => {
    const out: CacheDisplayRow[] = []
    for (const e of cacheEntries()) {
      const key = e.key
      const base = {
        key,
        path: e.path,
        sizeBytes: Number(e.size_bytes ?? 0),
        lastUsedUnixMs: Number(e.last_used_unix_ms ?? 0),
      }

      const mc = parseMinecraftCacheKey(key)
      if (key === 'minecraft:vanilla') {
        out.push({
          groupId: 'minecraft',
          kind: 'aggregate',
          title: 'All cached versions',
          meta: 'aggregate',
          ...base,
        })
        continue
      }
      if (mc) {
        out.push({
          groupId: 'minecraft',
          kind: 'version',
          title: mc.version,
          version: mc.version,
          meta: `sha1 ${mc.sha1.slice(0, 8)}`,
          ...base,
        })
        continue
      }

      if (key === 'terraria:vanilla') {
        out.push({
          groupId: 'terraria',
          kind: 'aggregate',
          title: 'All cached versions',
          meta: 'aggregate',
          ...base,
        })
        continue
      }
      if (key.startsWith('terraria:vanilla@')) {
        const version = key.slice('terraria:vanilla@'.length)
        out.push({
          groupId: 'terraria',
          kind: 'version',
          title: version || key,
          version: version || undefined,
          ...base,
        })
        continue
      }

      out.push({
        groupId: 'other',
        kind: 'other',
        title: key,
        ...base,
      })
    }

    const q = cacheSearch().trim().toLowerCase()
    if (!q) return out
    return out.filter((row) => {
      if (row.title.toLowerCase().includes(q)) return true
      if (row.key.toLowerCase().includes(q)) return true
      if (row.path.toLowerCase().includes(q)) return true
      if ((row.meta ?? '').toLowerCase().includes(q)) return true
      return false
    })
  })

  const cacheGroups = createMemo(() => {
    const byId = new Map<CacheDisplayRow['groupId'], CacheDisplayRow[]>()
    for (const row of cacheDisplayRows()) {
      const list = byId.get(row.groupId)
      if (list) list.push(row)
      else byId.set(row.groupId, [row])
    }

    const kindRank = (row: CacheDisplayRow) => {
      if (row.kind === 'aggregate') return 0
      if (row.kind === 'source') return 0
      if (row.kind === 'marker') return 1
      if (row.kind === 'version') return 2
      return 3
    }

    const compareRow = (a: CacheDisplayRow, b: CacheDisplayRow) => {
      const rank = kindRank(a) - kindRank(b)
      if (rank !== 0) return rank

      if (a.kind === 'version' && b.kind === 'version') {
        return compareVersionDesc(a.version ?? '', b.version ?? '') || b.lastUsedUnixMs - a.lastUsedUnixMs
      }

      if (a.groupId === 'other') {
        return b.sizeBytes - a.sizeBytes || b.lastUsedUnixMs - a.lastUsedUnixMs || a.key.localeCompare(b.key)
      }

      return b.lastUsedUnixMs - a.lastUsedUnixMs || a.key.localeCompare(b.key)
    }

    const order: CacheDisplayRow['groupId'][] = ['minecraft', 'terraria', 'other']
    const groups: Array<{ id: CacheDisplayRow['groupId']; title: string; entries: CacheDisplayRow[]; totalBytes: number; lastUsedUnixMs: number }> = []
    for (const id of order) {
      const entries = byId.get(id) ?? []
      if (!entries.length) continue
      entries.sort(compareRow)
      const totalBytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0)
      const lastUsedUnixMs = entries.reduce((max, e) => Math.max(max, e.lastUsedUnixMs), 0)
      groups.push({ id, title: groupTitle(id), entries, totalBytes, lastUsedUnixMs })
    }
    return groups
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
              icon={<GameAvatar name={templateDisplayLabel('minecraft:vanilla')} src={templateLogoSrc('minecraft:vanilla')} />}
              label="Minecraft"
              meta={
                mcCachedVersions().length > 0
                  ? `${mcCachedVersions().length} cached · latest ${mcCachedVersions()[0]?.version ?? ''}`.trim()
                  : 'Not cached'
              }
            />
            <NavItem
              value="terraria"
              current={view}
              onSelect={setView}
              icon={<GameAvatar name={templateDisplayLabel('terraria:vanilla')} src={templateLogoSrc('terraria:vanilla')} />}
              label="Terraria"
              meta={
                trCachedVersions().length > 0
                  ? `${trCachedVersions().length} cached · latest ${trCachedVersions()[0]?.version ?? ''}`.trim()
                  : 'Not cached'
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
                        description="Pick a version in Minecraft or Terraria to start downloading."
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
                      Showing {cacheDisplayRows().length}/{cacheEntries().length}
                    </div>
                  </div>

                  <Show
                    when={cacheDisplayRows().length > 0}
                    fallback={<EmptyState title="No cache entries" description="Queue a version to populate the cache." class="m-4" />}
                  >
                    <div class="space-y-4 p-4">
                      <For each={cacheGroups()}>
                        {(g) => (
                          <div class="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
                            <div class="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-3 dark:bg-slate-900/20">
                              <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">{g.title}</div>
                              <div class="flex flex-wrap items-center gap-2">
                                <span class="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                                  {g.entries.length} entries
                                </span>
                                <span class="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                                  {formatBytes(g.totalBytes)}
                                </span>
                                <span class="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                                  {formatRelativeTime(g.lastUsedUnixMs)}
                                </span>
                              </div>
                            </div>

                            <div class="divide-y divide-slate-200 dark:divide-slate-800">
                              <For each={g.entries}>
                                {(e) => (
                                  <div class="grid gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900/20 md:grid-cols-[minmax(0,1fr)_220px] md:items-start">
                                    <div class="min-w-0">
                                      <div class="flex flex-wrap items-center gap-2">
                                        <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">{e.title}</div>
                                        <Show when={e.meta}>
                                          <span class="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                                            {e.meta}
                                          </span>
                                        </Show>
                                      </div>
                                      <div class="mt-1 space-y-1">
                                        <div class="break-all font-mono text-[12px] text-slate-700 dark:text-slate-200" title={e.key}>
                                          {e.key}
                                        </div>
                                        <div class="break-all font-mono text-[12px] text-slate-500 dark:text-slate-400" title={e.path}>
                                          {e.path}
                                        </div>
                                      </div>
                                    </div>

                                    <div class="flex flex-none items-center justify-between gap-3 md:justify-end">
                                      <div class="flex flex-col items-end gap-1 font-mono text-[12px] text-slate-600 dark:text-slate-300">
                                        <div class="text-slate-900 dark:text-slate-100">{formatBytes(e.sizeBytes)}</div>
                                        <div title={new Date(e.lastUsedUnixMs).toLocaleString()}>{formatRelativeTime(e.lastUsedUnixMs)}</div>
                                      </div>
                                      <IconButton
                                        label="Delete cache entry"
                                        variant="danger"
                                        disabled={deleteDisabled()}
                                        onClick={() => void deleteCacheKey(e.key, `${g.title} ${e.title}`)}
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
                                )}
                              </For>
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
