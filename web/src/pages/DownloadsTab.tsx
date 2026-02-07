import { For, Show } from 'solid-js'
import { ArrowDown, ArrowUp, Download, Pause, Play, RotateCw, Trash2, X } from 'lucide-solid'
import { Dropdown } from '../components/Dropdown'
import { Banner } from '../components/ui/Banner'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Field } from '../components/ui/Field'
import { IconButton } from '../components/ui/IconButton'
import { Input } from '../components/ui/Input'
import { Tabs } from '../components/ui/Tabs'
import { TemplateMark } from '../components/ui/TemplateMark'
import { DownloadProgress } from '../app/primitives/DownloadProgress'
import { downloadJobProgressMessage, downloadJobStatusLabel, downloadJobStatusVariant, downloadTargetLabel } from '../app/helpers/downloads'
import { formatBytes, formatRelativeTime } from '../app/helpers/format'
import { instanceCardBackdrop } from '../app/helpers/instances'

export type DownloadsTabProps = {
  tab: () => string
  [key: string]: unknown
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
    downloadInstalledRows,
    downloadUpdateRows,
    downloadNowUnixMs,
    isReadOnly,
    downloadEnqueueTarget,
    downloadStatus,
    controlDiagnostics,
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

  return (
              <Show when={tab() === 'downloads'}>
                <div class="min-h-0 flex-1 overflow-auto p-4">
                  <div class="mx-auto w-full max-w-5xl space-y-4">
                    <div class="relative overflow-hidden rounded-3xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                      <div
                        class="pointer-events-none absolute -top-24 -right-24 h-56 w-56 rounded-full bg-amber-400/20 blur-3xl"
                        aria-hidden="true"
                      />
                      <div
                        class="pointer-events-none absolute -bottom-24 -left-24 h-56 w-56 rounded-full bg-sky-400/15 blur-3xl dark:bg-violet-400/10"
                        aria-hidden="true"
                      />
                      <div class="relative flex flex-wrap items-start justify-between gap-3">
                        <div class="min-w-0">
                          <div class="flex flex-wrap items-center gap-2">
                            <div class="text-page-title">Download Center</div>
                            <Badge variant={hasRunningDownloadJobs() ? 'warning' : 'neutral'}>
                              {hasRunningDownloadJobs() ? 'Running' : 'Idle'}
                            </Badge>
                            <Show when={downloadQueuePaused()}>
                              <Badge variant="warning">Queue paused</Badge>
                            </Show>
                            <Show when={downloadJobs().length > 0}>
                              <Badge variant="neutral">{downloadJobs().length} tasks</Badge>
                            </Show>
                          </div>
                          <div class="mt-1 text-desc">
                            Warm server files once so Create/Start stays instant — even when the reverse proxy times out.
                          </div>
                        </div>

                        <div class="flex flex-wrap items-center gap-2">
                          <Tabs
                            value={downloadCenterView()}
                            options={[
                              { value: 'library', label: 'Library' },
                              { value: 'queue', label: 'Queue' },
                              { value: 'installed', label: 'Installed' },
                              { value: 'updates', label: 'Updates' },
                            ]}
                            onChange={setDownloadCenterView}
                          />
                          <Show when={downloadCenterView() === 'queue'}>
                            <Button
                              size="xs"
                              variant="secondary"
                              leftIcon={
                                downloadQueuePaused() ? (
                                  <Play class="h-4 w-4" aria-hidden="true" />
                                ) : (
                                  <Pause class="h-4 w-4" aria-hidden="true" />
                                )
                              }
                              onClick={() => void toggleDownloadQueuePaused()}
                            >
                              {downloadQueuePaused() ? 'Resume queue' : 'Pause queue'}
                            </Button>
                            <Button
                              size="xs"
                              variant="secondary"
                              leftIcon={<Trash2 class="h-4 w-4" aria-hidden="true" />}
                              disabled={hasRunningDownloadJobs() || downloadJobs().length === 0}
                              onClick={() => void clearDownloadHistory()}
                            >
                              Clear history
                            </Button>
                          </Show>
                        </div>
                      </div>
                    </div>

                    <Banner
                      variant="warning"
                      title="Reverse proxy timeouts are OK"
                      message="If Create returns HTTP 504, it usually means the proxy timed out while backend download is still running. Warm files here first, then Create will be fast."
                      actions={
                        downloadCenterView() !== 'queue' ? (
                          <Button size="xs" variant="secondary" onClick={() => setDownloadCenterView('queue')}>
                            Open queue
                          </Button>
                        ) : undefined
                      }
                    />

                    <Show when={downloadCenterView() === 'queue'}>
                      <div class="rounded-3xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <div class="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">Queue</div>
                            <div class="mt-1 text-desc">
                              Manage active and historical download jobs: reorder, pause, retry, and inspect details.
                            </div>
                          </div>
                          <div class="flex items-center gap-2">
                            <Badge variant={hasRunningDownloadJobs() ? 'warning' : 'neutral'}>
                              {hasRunningDownloadJobs() ? 'Running' : 'Idle'}
                            </Badge>
                            <Show when={downloadQueuePaused()}>
                              <Badge variant="warning">Paused</Badge>
                            </Show>
                          </div>
                        </div>

                        <Show
                          when={downloadJobs().length > 0}
                          fallback={
                            <EmptyState
                              title="No download jobs yet"
                              description="Open Library and queue a template to warm the cache."
                              actions={
                                <Button size="sm" variant="secondary" onClick={() => setDownloadCenterView('library')}>
                                  Open Library
                                </Button>
                              }
                              class="mt-4"
                            />
                          }
                        >
                          <div class="mt-4 space-y-3">
                            <For each={downloadJobs()}>
                              {(job) => {
                                const progressMessage = () => downloadJobProgressMessage(job, downloadNowUnixMs())

                                return (
                                  <div
                                    class={`rounded-2xl border bg-white/60 p-3 shadow-sm dark:bg-slate-950/40 dark:shadow-none ${
                                      job.state === 'running'
                                        ? 'border-amber-200 ring-1 ring-amber-500/20 dark:border-amber-900/40'
                                        : job.state === 'error'
                                          ? 'border-rose-200 ring-1 ring-rose-500/10 dark:border-rose-900/40'
                                          : 'border-slate-200 dark:border-slate-800'
                                    }`}
                                  >
                                    <div class="flex flex-wrap items-start justify-between gap-3">
                                      <div class="flex min-w-0 items-start gap-3">
                                        <TemplateMark templateId={job.templateId} />
                                        <div class="min-w-0">
                                          <div class="flex flex-wrap items-center gap-2">
                                            <div class="text-xs font-semibold text-slate-900 dark:text-slate-100">
                                              {downloadTargetLabel(job.target)}
                                            </div>
                                            <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
                                              {job.version}
                                            </span>
                                            <Badge variant={downloadJobStatusVariant(job.state)}>{downloadJobStatusLabel(job.state)}</Badge>
                                          </div>
                                          <div class="mt-1 text-mono-muted">{formatRelativeTime(job.updatedAtUnixMs)}</div>
                                        </div>
                                      </div>

                                      <div class="flex flex-none items-center gap-1">
                                        <IconButton
                                          label="Move up"
                                          variant="ghost"
                                          disabled={job.state === 'running'}
                                          onClick={() => void moveDownloadJob(job.id, -1)}
                                        >
                                          <ArrowUp class="h-4 w-4" aria-hidden="true" />
                                        </IconButton>
                                        <IconButton
                                          label="Move down"
                                          variant="ghost"
                                          disabled={job.state === 'running'}
                                          onClick={() => void moveDownloadJob(job.id, 1)}
                                        >
                                          <ArrowDown class="h-4 w-4" aria-hidden="true" />
                                        </IconButton>
                                      </div>
                                    </div>

                                    <Show
                                      when={job.state === 'running'}
                                      fallback={<div class="mt-2 text-xs text-slate-600 dark:text-slate-300">{job.message}</div>}
                                    >
                                      <DownloadProgress templateId={job.templateId} message={progressMessage()} />
                                    </Show>

                                    <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
                                      <Button size="xs" variant="secondary" onClick={() => setSelectedDownloadJobId(job.id)}>
                                        Details
                                      </Button>

                                      <div class="flex items-center gap-1">
                                        <Show when={job.state === 'queued'}>
                                          <IconButton label="Pause" variant="secondary" onClick={() => void pauseDownloadJob(job.id)}>
                                            <Pause class="h-4 w-4" aria-hidden="true" />
                                          </IconButton>
                                        </Show>
                                        <Show when={job.state === 'paused'}>
                                          <IconButton label="Resume" variant="secondary" onClick={() => void resumeDownloadJob(job.id)}>
                                            <Play class="h-4 w-4" aria-hidden="true" />
                                          </IconButton>
                                        </Show>
                                        <Show when={job.state === 'queued' || job.state === 'paused'}>
                                          <IconButton label="Cancel" variant="danger" onClick={() => void cancelDownloadJob(job.id)}>
                                            <X class="h-4 w-4" aria-hidden="true" />
                                          </IconButton>
                                        </Show>
                                        <Show when={job.state === 'error' || job.state === 'success' || job.state === 'canceled'}>
                                          <IconButton label="Retry" variant="secondary" onClick={() => void retryDownloadJob(job.id)}>
                                            <RotateCw class="h-4 w-4" aria-hidden="true" />
                                          </IconButton>
                                        </Show>
                                      </div>
                                    </div>

                                    <Show when={job.requestId}>
                                      <div class="mt-2 text-mono-muted">req {job.requestId}</div>
                                    </Show>
                                  </div>
                                )
                              }}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </Show>

                    <Show when={downloadCenterView() === 'queue' || downloadCenterView() === 'library'}>
                      <div class="space-y-3">
                        <div class="flex flex-wrap items-end justify-between gap-3">
                          <div>
                            <div class="text-section-title">Library</div>
                            <div class="mt-1 text-desc">
                              Queue a warm download for each template. Cache is shared across instances on this node.
                            </div>
                          </div>
                        </div>

                        <div class="grid gap-3 lg:grid-cols-3">
                          <div class="group relative overflow-hidden rounded-3xl border border-slate-200 bg-white/62 p-4 shadow-sm transition-all duration-150 hover:bg-white/72 hover:shadow-md dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none dark:hover:bg-slate-950/60">
                            <Show when={instanceCardBackdrop('minecraft:vanilla')}>
                              {(bg) => (
                                <>
                                  <img
                                    src={bg().src}
                                    alt=""
                                    aria-hidden="true"
                                    class="pointer-events-none absolute inset-0 h-full w-full select-none object-cover opacity-[0.34] saturate-110 contrast-115 blur-[1.4px] transition-transform duration-300 group-hover:scale-[1.04] dark:opacity-[0.3]"
                                    style={{ 'object-position': bg().position }}
                                    loading="lazy"
                                    decoding="async"
                                  />
                                  <div class="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-r from-white/84 via-white/62 to-white/26 dark:from-slate-950/90 dark:via-slate-950/72 dark:to-slate-950/56" />
                                  <div class="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-b from-transparent to-white/10 dark:to-slate-950/18" />
                                  <div class="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(130%_92%_at_86%_56%,rgba(15,23,42,0)_32%,rgba(15,23,42,0.28)_100%)] dark:bg-[radial-gradient(130%_92%_at_86%_56%,rgba(2,6,23,0)_26%,rgba(2,6,23,0.55)_100%)]" />
                                  <div class="pointer-events-none absolute inset-x-0 bottom-0 h-20 rounded-b-3xl bg-gradient-to-t from-white/70 via-white/52 to-transparent dark:from-slate-950/78 dark:via-slate-950/62 dark:to-transparent" />
                                </>
                              )}
                            </Show>

                            <div class="relative z-10">
                              <div class="flex items-start justify-between gap-3">
                                <div class="flex min-w-0 items-start gap-3">
                                  <TemplateMark templateId="minecraft:vanilla" />
                                  <div class="min-w-0">
                                    <div class="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                      Minecraft (Vanilla)
                                    </div>
                                    <div class="mt-0.5 text-mono-muted">minecraft:vanilla</div>
                                  </div>
                                </div>

                                <Show when={downloadInstalledRows().find((r: any) => r.target === 'minecraft_vanilla')}>
                                  {(row) => (
                                    <div class="flex flex-col items-end gap-1">
                                      <Badge variant={row().installed ? 'success' : 'neutral'}>
                                        {row().installed ? 'Cached' : 'Missing'}
                                      </Badge>
                                      <div class="text-mono-muted">{formatBytes(row().sizeBytes)}</div>
                                    </div>
                                  )}
                                </Show>
                              </div>

                              <div class="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                                <Field label="Version">
                                  <Dropdown
                                    label=""
                                    value={downloadMcVersion()}
                                    options={mcVersionOptions()}
                                    onChange={setDownloadMcVersion}
                                  />
                                </Field>
                                <Button
                                  size="sm"
                                  variant="primary"
                                  leftIcon={<Download class="h-4 w-4" aria-hidden="true" />}
                                  loading={downloadQueueEnqueue.isPending && downloadEnqueueTarget() === 'minecraft_vanilla'}
                                  disabled={isReadOnly()}
                                  title={isReadOnly() ? 'Read-only mode' : 'Queue warm download'}
                                  onClick={() => void enqueueDownloadWarm('minecraft_vanilla')}
                                >
                                  Queue download
                                </Button>
                              </div>

                              <Show when={downloadInstalledRows().find((r: any) => r.target === 'minecraft_vanilla')}>
                                {(row) => (
                                  <div class="mt-2 text-mono-muted">
                                    installed {row().installedVersion} · last used {formatRelativeTime(row().lastUsedUnixMs)}
                                  </div>
                                )}
                              </Show>

                              <Show when={downloadStatus().get('minecraft_vanilla')}>
                                {(s) => (
                                  <div
                                    class={`mt-3 rounded-2xl border px-3 py-2 text-xs ${
                                      s().ok
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200'
                                        : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200'
                                    }`}
                                  >
                                    {s().message}
                                    <div class="mt-1 text-mono-muted opacity-80">{formatRelativeTime(s().atUnixMs)}</div>
                                  </div>
                                )}
                              </Show>
                            </div>
                          </div>

                          <div class="group relative overflow-hidden rounded-3xl border border-slate-200 bg-white/62 p-4 shadow-sm transition-all duration-150 hover:bg-white/72 hover:shadow-md dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none dark:hover:bg-slate-950/60">
                            <Show when={instanceCardBackdrop('terraria:vanilla')}>
                              {(bg) => (
                                <>
                                  <img
                                    src={bg().src}
                                    alt=""
                                    aria-hidden="true"
                                    class="pointer-events-none absolute inset-0 h-full w-full select-none object-cover opacity-[0.34] saturate-110 contrast-115 blur-[1.4px] transition-transform duration-300 group-hover:scale-[1.04] dark:opacity-[0.3]"
                                    style={{ 'object-position': bg().position }}
                                    loading="lazy"
                                    decoding="async"
                                  />
                                  <div class="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-r from-white/84 via-white/62 to-white/26 dark:from-slate-950/90 dark:via-slate-950/72 dark:to-slate-950/56" />
                                  <div class="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-b from-transparent to-white/10 dark:to-slate-950/18" />
                                  <div class="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(130%_92%_at_86%_56%,rgba(15,23,42,0)_32%,rgba(15,23,42,0.28)_100%)] dark:bg-[radial-gradient(130%_92%_at_86%_56%,rgba(2,6,23,0)_26%,rgba(2,6,23,0.55)_100%)]" />
                                  <div class="pointer-events-none absolute inset-x-0 bottom-0 h-20 rounded-b-3xl bg-gradient-to-t from-white/70 via-white/52 to-transparent dark:from-slate-950/78 dark:via-slate-950/62 dark:to-transparent" />
                                </>
                              )}
                            </Show>

                            <div class="relative z-10">
                              <div class="flex items-start justify-between gap-3">
                                <div class="flex min-w-0 items-start gap-3">
                                  <TemplateMark templateId="terraria:vanilla" />
                                  <div class="min-w-0">
                                    <div class="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                      Terraria (Vanilla)
                                    </div>
                                    <div class="mt-0.5 text-mono-muted">terraria:vanilla</div>
                                  </div>
                                </div>

                                <Show when={downloadInstalledRows().find((r: any) => r.target === 'terraria_vanilla')}>
                                  {(row) => (
                                    <div class="flex flex-col items-end gap-1">
                                      <Badge variant={row().installed ? 'success' : 'neutral'}>
                                        {row().installed ? 'Cached' : 'Missing'}
                                      </Badge>
                                      <div class="text-mono-muted">{formatBytes(row().sizeBytes)}</div>
                                    </div>
                                  )}
                                </Show>
                              </div>

                              <div class="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                                <Field label="Version">
                                  <Dropdown
                                    label=""
                                    value={downloadTrVersion()}
                                    options={trVersionOptions()}
                                    onChange={setDownloadTrVersion}
                                  />
                                </Field>
                                <Button
                                  size="sm"
                                  variant="primary"
                                  leftIcon={<Download class="h-4 w-4" aria-hidden="true" />}
                                  loading={downloadQueueEnqueue.isPending && downloadEnqueueTarget() === 'terraria_vanilla'}
                                  disabled={isReadOnly()}
                                  title={isReadOnly() ? 'Read-only mode' : 'Queue warm download'}
                                  onClick={() => void enqueueDownloadWarm('terraria_vanilla')}
                                >
                                  Queue download
                                </Button>
                              </div>

                              <Show when={downloadInstalledRows().find((r: any) => r.target === 'terraria_vanilla')}>
                                {(row) => (
                                  <div class="mt-2 text-mono-muted">
                                    installed {row().installedVersion} · last used {formatRelativeTime(row().lastUsedUnixMs)}
                                  </div>
                                )}
                              </Show>

                              <Show when={downloadStatus().get('terraria_vanilla')}>
                                {(s) => (
                                  <div
                                    class={`mt-3 rounded-2xl border px-3 py-2 text-xs ${
                                      s().ok
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200'
                                        : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200'
                                    }`}
                                  >
                                    {s().message}
                                    <div class="mt-1 text-mono-muted opacity-80">{formatRelativeTime(s().atUnixMs)}</div>
                                  </div>
                                )}
                              </Show>
                            </div>
                          </div>

                          <div class="group relative overflow-hidden rounded-3xl border border-slate-200 bg-white/62 p-4 shadow-sm transition-all duration-150 hover:bg-white/72 hover:shadow-md dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none dark:hover:bg-slate-950/60">
                            <Show when={instanceCardBackdrop('dsp:nebula')}>
                              {(bg) => (
                                <>
                                  <img
                                    src={bg().src}
                                    alt=""
                                    aria-hidden="true"
                                    class="pointer-events-none absolute inset-0 h-full w-full select-none object-cover opacity-[0.34] saturate-110 contrast-115 blur-[1.4px] transition-transform duration-300 group-hover:scale-[1.04] dark:opacity-[0.3]"
                                    style={{ 'object-position': bg().position }}
                                    loading="lazy"
                                    decoding="async"
                                  />
                                  <div class="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-r from-white/84 via-white/62 to-white/26 dark:from-slate-950/90 dark:via-slate-950/72 dark:to-slate-950/56" />
                                  <div class="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-b from-transparent to-white/10 dark:to-slate-950/18" />
                                  <div class="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(130%_92%_at_86%_56%,rgba(15,23,42,0)_32%,rgba(15,23,42,0.28)_100%)] dark:bg-[radial-gradient(130%_92%_at_86%_56%,rgba(2,6,23,0)_26%,rgba(2,6,23,0.55)_100%)]" />
                                  <div class="pointer-events-none absolute inset-x-0 bottom-0 h-20 rounded-b-3xl bg-gradient-to-t from-white/70 via-white/52 to-transparent dark:from-slate-950/78 dark:via-slate-950/62 dark:to-transparent" />
                                </>
                              )}
                            </Show>

                            <div class="relative z-10">
                              <div class="flex items-start justify-between gap-3">
                                <div class="flex min-w-0 items-start gap-3">
                                  <TemplateMark templateId="dsp:nebula" />
                                  <div class="min-w-0">
                                    <div class="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                      DSP (Nebula)
                                    </div>
                                    <div class="mt-0.5 text-mono-muted">dsp:nebula</div>
                                  </div>
                                </div>

                                <Badge variant={hasSavedSteamcmdCreds() ? 'success' : 'warning'}>
                                  {hasSavedSteamcmdCreds() ? 'SteamCMD ready' : 'SteamCMD required'}
                                </Badge>
                              </div>

                              <div class="mt-2 text-desc">
                                Uses SteamCMD credentials in Settings. Auto 2FA is supported when maFile/shared_secret is imported.
                              </div>

                              <Show when={!hasSavedSteamcmdCreds()}>
                                <Banner
                                  variant="warning"
                                  title="SteamCMD credentials missing"
                                  message="Open Settings and add Steam username/password (and optionally Auto 2FA)."
                                  actions={
                                    <Button size="xs" variant="secondary" onClick={() => setTab('settings')}>
                                      Open Settings
                                    </Button>
                                  }
                                  class="mt-3"
                                />
                              </Show>

                              <div class="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                                <Field label="Steam Guard code (optional)">
                                  <Input
                                    value={downloadDspGuardCode()}
                                    onInput={(e) => setDownloadDspGuardCode(e.currentTarget.value)}
                                    placeholder="Only needed when Auto 2FA is unavailable"
                                    autocomplete="one-time-code"
                                    class="font-mono text-[11px]"
                                  />
                                </Field>
                                <Button
                                  size="sm"
                                  variant="primary"
                                  leftIcon={<Download class="h-4 w-4" aria-hidden="true" />}
                                  loading={downloadQueueEnqueue.isPending && downloadEnqueueTarget() === 'dsp_nebula'}
                                  disabled={isReadOnly()}
                                  title={isReadOnly() ? 'Read-only mode' : 'Queue warm download'}
                                  onClick={() => void enqueueDownloadWarm('dsp_nebula')}
                                >
                                  Queue download
                                </Button>
                              </div>

                              <Show when={downloadInstalledRows().find((r: any) => r.target === 'dsp_nebula')}>
                                {(row) => (
                                  <div class="mt-2 text-mono-muted">
                                    installed {row().installedVersion} · last used {formatRelativeTime(row().lastUsedUnixMs)}
                                  </div>
                                )}
                              </Show>

                              <Show when={downloadStatus().get('dsp_nebula')}>
                                {(s) => (
                                  <div
                                    class={`mt-3 rounded-2xl border px-3 py-2 text-xs ${
                                      s().ok
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200'
                                        : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200'
                                    }`}
                                  >
                                    {s().message}
                                    <Show when={s().requestId}>
                                      <div class="mt-1 text-mono-muted opacity-80">req {s().requestId}</div>
                                    </Show>
                                    <div class="mt-1 text-mono-muted opacity-80">{formatRelativeTime(s().atUnixMs)}</div>
                                  </div>
                                )}
                              </Show>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Show>

                    <Show when={downloadCenterView() === 'installed'}>
                      <div class="rounded-3xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <div class="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">Installed</div>
                            <div class="mt-1 text-desc">What’s currently cached on this node.</div>
                          </div>
                        </div>

                        <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          <For each={downloadInstalledRows()}>
                            {(row) => (
                              <div class="rounded-2xl border border-slate-200 bg-white/60 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                                <div class="flex items-start gap-3">
                                  <TemplateMark templateId={row.templateId} />
                                  <div class="min-w-0">
                                    <div class="flex flex-wrap items-center gap-2">
                                      <div class="font-semibold text-slate-900 dark:text-slate-100">{downloadTargetLabel(row.target)}</div>
                                      <Badge variant={row.installed ? 'success' : 'neutral'}>{row.installed ? 'Cached' : 'Missing'}</Badge>
                                    </div>
                                    <div class="mt-1 text-mono-muted">{row.installedVersion}</div>
                                    <div class="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
                                      size {formatBytes(row.sizeBytes)} · last used {formatRelativeTime(row.lastUsedUnixMs)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>

                    <Show when={downloadCenterView() === 'updates'}>
                      <div class="rounded-3xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <div class="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">Updates</div>
                            <div class="mt-1 text-desc">
                              Compare cached versions with the latest known versions and queue updates when needed.
                            </div>
                          </div>
                        </div>

                        <div class="mt-4 space-y-3">
                          <For each={downloadUpdateRows()}>
                            {(row) => (
                              <div class="rounded-2xl border border-slate-200 bg-white/60 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                                <div class="flex flex-wrap items-start justify-between gap-3">
                                  <div class="flex min-w-0 items-start gap-3">
                                    <TemplateMark templateId={row.templateId} />
                                    <div class="min-w-0">
                                      <div class="flex flex-wrap items-center gap-2">
                                        <div class="font-semibold text-slate-900 dark:text-slate-100">
                                          {downloadTargetLabel(row.target)}
                                        </div>
                                        <Badge variant={row.updateAvailable ? 'warning' : 'success'}>
                                          {row.updateAvailable ? 'Update available' : 'Up to date'}
                                        </Badge>
                                      </div>
                                      <div class="mt-1 text-mono-muted">
                                        {row.installedVersion} → {row.latestVersion}
                                      </div>
                                    </div>
                                  </div>

                                  <Button
                                    size="xs"
                                    variant="secondary"
                                    disabled={isReadOnly() || !row.updateAvailable}
                                    onClick={() => void enqueueDownloadWarm(row.target)}
                                  >
                                    {row.updateAvailable ? 'Queue update' : 'Up to date'}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>


                    <div class="rounded-3xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                      <div class="flex flex-wrap items-end justify-between gap-3">
                        <div>
                          <div class="text-section-title">Cache</div>
                          <div class="mt-1 text-desc">Recent cache entries (key + size).</div>
                        </div>
                        <Show when={(controlDiagnostics.data?.cache?.entries ?? []).length > 0}>
                          <div class="text-mono-muted">{(controlDiagnostics.data?.cache?.entries ?? []).length} entries</div>
                        </Show>
                      </div>

                      <Show
                        when={(controlDiagnostics.data?.cache?.entries ?? []).length > 0}
                        fallback={
                          <EmptyState
                            title="No cache entries yet"
                            description="Queue a download in Library to populate the cache."
                            class="mt-3"
                          />
                        }
                      >
                        <div class="mt-3 grid gap-2 sm:grid-cols-2">
                          <For each={(controlDiagnostics.data?.cache?.entries ?? []).slice(0, 8)}>
                            {(e) => (
                              <div class="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white/60 px-3 py-2 text-[11px] shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                                <span class="min-w-0 truncate font-mono text-slate-700 dark:text-slate-200" title={e.key}>
                                  {e.key}
                                </span>
                                <span class="font-mono text-slate-500">{formatBytes(Number(e.size_bytes))}</span>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  </div>
                </div>
              </Show>
  )
}
