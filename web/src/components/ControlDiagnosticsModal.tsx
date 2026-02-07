import { For, Show } from 'solid-js'
import { formatBytes, formatRelativeTime } from '../app/helpers/format'
import { downloadJson, safeCopy } from '../app/helpers/misc'
import { queryClient } from '../rspc'
import { Button } from './ui/Button'
import { ErrorState } from './ui/ErrorState'
import { IconButton } from './ui/IconButton'
import { Modal } from './ui/Modal'

export type ControlDiagnosticsModalProps = {
  [key: string]: unknown
}

export default function ControlDiagnosticsModal(props: ControlDiagnosticsModalProps) {
  const {
    showDiagnosticsModal,
    setShowDiagnosticsModal,
    controlDiagnostics,
    pushToast,
    clearCache,
    cacheSelection,
    setCacheSelection,
    toastError,
  } = props as any

  return (
        <Modal
          open={showDiagnosticsModal()}
          onClose={() => setShowDiagnosticsModal(false)}
          title="Diagnostics"
          description={
            controlDiagnostics.data?.request_id
              ? `req ${controlDiagnostics.data.request_id}`
              : controlDiagnostics.isPending
                ? 'loading…'
                : undefined
          }
          size="xl"
          footer={
            <div class="flex flex-wrap justify-end gap-2">
              <IconButton
                type="button"
                label="Refresh"
                title="Refresh diagnostics"
                variant="secondary"
                disabled={controlDiagnostics.isPending}
                onClick={() => void queryClient.invalidateQueries({ queryKey: ['control.diagnostics', null] })}
              >
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
              <Button
                size="sm"
                variant="secondary"
                disabled={!controlDiagnostics.data}
                onClick={async () => {
                  if (!controlDiagnostics.data) return
                  await safeCopy(JSON.stringify(controlDiagnostics.data, null, 2))
                  pushToast('success', 'Copied', 'Diagnostics copied to clipboard.')
                }}
              >
                Copy
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!controlDiagnostics.data}
                onClick={() => {
                  if (!controlDiagnostics.data) return
                  downloadJson(`alloy-control-diagnostics.json`, { type: 'alloy-control-diagnostics', ...controlDiagnostics.data })
                }}
              >
                Download
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowDiagnosticsModal(false)}>
                Close
              </Button>
            </div>
          }
        >
          <div class="space-y-4">
                <Show when={controlDiagnostics.isPending}>
                  <div class="grid gap-3 sm:grid-cols-2">
                    <div class="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
                    <div class="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
                  </div>
                </Show>

                <Show when={controlDiagnostics.isError}>
                  <ErrorState
                    title="Failed to load diagnostics"
                    error={controlDiagnostics.error}
                    onRetry={() => void queryClient.invalidateQueries({ queryKey: ['control.diagnostics', null] })}
                  />
                </Show>

                <Show when={controlDiagnostics.data}>
                  {(d) => (
                    <div class="grid gap-4 lg:grid-cols-3">
                      <div class="space-y-4 lg:col-span-2">
                        <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                          <div class="flex flex-wrap items-center justify-between gap-2">
                            <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Control</div>
                            <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                              <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40">
                                v{d().control_version}
                              </span>
                              <span
                                class={`rounded-full border px-2 py-0.5 font-mono ${
                                  d().read_only
                                    ? 'border-amber-300 bg-amber-500/10 text-amber-800 dark:border-amber-500/30 dark:text-amber-200'
                                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200'
                                }`}
                              >
                                {d().read_only ? 'read-only' : 'writable'}
                              </span>
                              <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40">
                                fs-write {d().fs.write_enabled ? 'on' : 'off'}
                              </span>
                            </div>
                          </div>
                          <div class="mt-3 text-[12px] text-slate-600 dark:text-slate-300">
                            fetched {new Date(Number(d().fetched_at_unix_ms)).toLocaleString()}
                          </div>
                        </div>

                        <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                          <div class="flex items-center justify-between">
                            <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Agent</div>
                            <span
                              class={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                                d().agent.ok
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200'
                                  : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200'
                              }`}
                            >
                              {d().agent.ok ? 'connected' : 'offline'}
                            </span>
                          </div>

                          <div class="mt-3 space-y-2 text-[12px] text-slate-600 dark:text-slate-300">
                            <div class="flex items-center justify-between gap-3">
                              <div class="text-slate-500 dark:text-slate-400">Endpoint</div>
                              <div class="min-w-0 truncate font-mono text-[11px]" title={d().agent.endpoint}>
                                {d().agent.endpoint}
                              </div>
                            </div>
                            <Show when={d().agent.agent_version}>
                              <div class="flex items-center justify-between gap-3">
                                <div class="text-slate-500 dark:text-slate-400">Version</div>
                                <div class="font-mono text-[11px]">{d().agent.agent_version}</div>
                              </div>
                            </Show>
                            <Show when={d().agent.data_root}>
                              <div class="flex items-center justify-between gap-3">
                                <div class="text-slate-500 dark:text-slate-400">Data root</div>
                                <div class="min-w-0 truncate font-mono text-[11px]" title={d().agent.data_root ?? ''}>
                                  {d().agent.data_root}
                                </div>
                              </div>
                            </Show>
                            <Show when={d().agent.data_root_free_bytes}>
                              <div class="flex items-center justify-between gap-3">
                                <div class="text-slate-500 dark:text-slate-400">Free space</div>
                                <div class="font-mono text-[11px]">{formatBytes(Number(d().agent.data_root_free_bytes))}</div>
                              </div>
                            </Show>
                            <Show when={d().agent.error}>
                              <div class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                                {d().agent.error}
                              </div>
                            </Show>
                          </div>
                        </div>

                        <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                          <div class="flex items-center justify-between gap-3">
                            <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Cache</div>
                            <Button
                              size="xs"
                              variant="danger"
                              loading={clearCache.isPending}
                              onClick={async () => {
                                const keys = Object.entries(cacheSelection())
                                  .filter(([, v]) => v)
                                  .map(([k]) => k)
                                if (!keys.length) {
                                  pushToast('info', 'No selection', 'Select caches to clear first.')
                                  return
                                }
                                try {
                                  const out = await clearCache.mutateAsync({ keys })
                                  pushToast('success', 'Cache cleared', `Freed ${formatBytes(Number(out.freed_bytes))}`)
                                  await queryClient.invalidateQueries({ queryKey: ['control.diagnostics', null] })
                                  await queryClient.invalidateQueries({ queryKey: ['process.cacheStats', null] })
                                } catch (e) {
                                  toastError('Clear cache failed', e)
                                }
                              }}
                            >
                              Clear selected
                            </Button>
                          </div>

                          <div class="mt-3 space-y-2">
                            <For each={d().cache.entries}>
                              {(e) => (
                                <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
                                  <label class="flex items-center gap-2 text-[12px] text-slate-700 dark:text-slate-200">
                                    <input
                                      type="checkbox"
                                      class="h-4 w-4 rounded border-slate-300 bg-white text-rose-600 focus:ring-rose-400 dark:border-slate-700 dark:bg-slate-950/60 dark:text-rose-400"
                                      checked={cacheSelection()[e.key] ?? false}
                                      onChange={(ev) =>
                                        setCacheSelection((prev: Record<string, boolean>) => ({ ...prev, [e.key]: ev.currentTarget.checked }))
                                      }
                                    />
                                    <span class="font-mono text-[11px]">{e.key}</span>
                                  </label>
                                  <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                    <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40">
                                      {formatBytes(Number(e.size_bytes))}
                                    </span>
                                    <span
                                      class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40"
                                      title={new Date(Number(e.last_used_unix_ms)).toLocaleString()}
                                    >
                                      {formatRelativeTime(Number(e.last_used_unix_ms))}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </For>
                            <div class="text-[11px] text-slate-500 dark:text-slate-400">
                              Clearing cache removes downloaded jars/zips. Next start will re-download.
                            </div>
                          </div>
                        </div>
                      </div>

                      <div class="space-y-4">
                        <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                          <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Agent log (tail)</div>
                          <Show
                            when={(d().agent_log_lines ?? []).length > 0}
                            fallback={<div class="mt-3 text-[12px] text-slate-500">(no log data)</div>}
                          >
                            <pre class="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-950 px-3 py-2 text-[11px] leading-relaxed text-slate-100">
                              <For each={d().agent_log_lines}>{(l) => <div class="whitespace-pre-wrap">{l}</div>}</For>
                            </pre>
                          </Show>
                          <Show when={d().agent_log_path}>
                            <div class="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                              <span class="truncate font-mono">{d().agent_log_path}</span>
                              <Button size="xs" variant="secondary" onClick={() => safeCopy(d().agent_log_path ?? '')}>
                                Copy
                              </Button>
                            </div>
                          </Show>
                        </div>
                      </div>
                    </div>
                  )}
                </Show>
              </div>
        </Modal>
  )
}
