import { For, Show } from 'solid-js'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { IconButton } from '../components/ui/IconButton'
import { Skeleton } from '../components/ui/Skeleton'
import { Button } from '../components/ui/Button'
import { isAlloyApiError } from '../rspc'
import { formatRelativeTime } from '../app/helpers/format'
import NodesPage from './NodesPage'

export type NodesTabProps = {
  tab: () => string
  [key: string]: unknown
}

export default function NodesTab(props: NodesTabProps) {
  const {
    tab,
    me,
    openCreateNode,
    nodesLastUpdatedAtUnixMs,
    nodes,
    invalidateNodes,
    selectedNodeId,
    setSelectedNodeId,
    selectedNode,
    setNodeEnabled,
    triggerNodeSelfUpdate,
    nodeSelfUpdateStatus,
    nodeEnabledOverride,
    setNodeEnabledOverride,
    updateCheck,
    pushToast,
    toastError,
  } = props as any

  type SimpleVersion = { major: number; minor: number; patch: number }

  function parseSimpleVersion(raw: string | null | undefined): SimpleVersion | null {
    if (!raw) return null
    const value = raw.trim().replace(/^v/i, '')
    if (!value) return null
    const parts = value.split(/[.+-]/)
    if (parts.length < 3) return null
    const major = Number.parseInt(parts[0] ?? '', 10)
    const minor = Number.parseInt(parts[1] ?? '', 10)
    const patch = Number.parseInt(parts[2] ?? '', 10)
    if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null
    return { major, minor, patch }
  }

  function compareSimpleVersion(a: SimpleVersion, b: SimpleVersion): number {
    if (a.major !== b.major) return a.major > b.major ? 1 : -1
    if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1
    if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1
    return 0
  }

  function nodeAgentUpdateState(node: { agent_version: string | null | undefined }) {
    const target = updateCheck.data?.agent_latest
    if (!target) {
      return {
        targetTag: null as string | null,
        updateAvailable: null as boolean | null,
      }
    }

    const currentParsed = parseSimpleVersion(node.agent_version)
    const targetParsed = parseSimpleVersion(target.version ?? target.tag)
    if (!currentParsed || !targetParsed) {
      return {
        targetTag: target.tag,
        updateAvailable: null as boolean | null,
      }
    }

    return {
      targetTag: target.tag,
      updateAvailable: compareSimpleVersion(currentParsed, targetParsed) < 0,
    }
  }

  function nodeUpdateDisabledReason(node: { id: string; enabled: boolean }): string | null {
    if (!node.enabled) return 'Enable this node first'
    if (selectedNodeId() !== node.id) return 'Select this node first'
    if (nodeSelfUpdateStatus.isPending) return 'Checking node updater status'
    if (nodeSelfUpdateStatus.isError) return 'Updater status unavailable'
    if (!nodeSelfUpdateStatus.data?.configured) return 'Node updater is not configured'
    return null
  }

  function nodeUpdateButtonLabel(node: { agent_version: string | null | undefined }): string {
    const state = nodeAgentUpdateState(node)
    if (state.updateAvailable === false) return 'Re-run update'
    return 'Update node'
  }

  function nodeUpdateButtonTitle(node: { id: string; enabled: boolean; agent_version: string | null | undefined }): string {
    const disabled = nodeUpdateDisabledReason(node)
    if (disabled) return disabled
    const state = nodeAgentUpdateState(node)
    if (state.updateAvailable === false) {
      return 'Node agent is already up to date (you can still force update)'
    }
    if (state.targetTag) {
      return `Trigger node self update (target ${state.targetTag})`
    }
    return 'Trigger node self update'
  }

  return (
              <Show when={tab() === 'nodes'}>
                <NodesPage
                  tabLabel="Nodes"
                  left={
                    <div class="space-y-3">
                      <div class="flex items-center justify-end gap-2">
                        <Show when={me()?.is_admin}>
                          <IconButton type="button" label="Add node" variant="secondary" onClick={() => openCreateNode()}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                              <path
                                fill-rule="evenodd"
                                d="M10 3.25a.75.75 0 01.75.75v5.25H16a.75.75 0 010 1.5h-5.25V16a.75.75 0 01-1.5 0v-5.25H4a.75.75 0 010-1.5h5.25V4a.75.75 0 01.75-.75z"
                                clip-rule="evenodd"
                              />
                            </svg>
                          </IconButton>
                        </Show>
                      </div>
                      <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span>Updated {formatRelativeTime(nodesLastUpdatedAtUnixMs())}</span>
                        <Show when={nodes.isPending}>
                          <span class="inline-flex items-center gap-1">
                            <span class="h-1.5 w-1.5 rounded-full bg-slate-500 animate-pulse" />
                            loading
                          </span>
                        </Show>
                        <Show when={nodes.isError}>
                          <span class="inline-flex items-center gap-1">
                            <span class="h-1.5 w-1.5 rounded-full bg-rose-500" />
                            error
                          </span>
                        </Show>
                      </div>

                      <Show when={nodes.isError} fallback={<></>}>
                        <ErrorState title="Failed to load nodes" error={nodes.error} onRetry={() => void invalidateNodes()} />
                      </Show>

                      <Show when={!nodes.isError}>
                        <Show when={nodes.isPending} fallback={<></>}>
                          <div class="rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                            <Skeleton lines={6} />
                          </div>
                        </Show>

                        <Show
                          when={!nodes.isPending && (nodes.data ?? []).length > 0}
                          fallback={
                            <Show when={!nodes.isPending}>
                              <EmptyState title="No nodes" description="No nodes registered yet." />
                            </Show>
                          }
                        >
                          <div class="max-h-96 overflow-auto rounded-xl border border-slate-200 bg-white/60 p-1 dark:border-slate-800 dark:bg-slate-950/40">
                            <For each={nodes.data ?? []}>
                              {(n) => (
                                <button
                                  type="button"
                                  class={`w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-900 ${
                                    selectedNodeId() === n.id ? 'bg-slate-100 dark:bg-slate-900' : ''
                                  }`}
                                  onClick={() => setSelectedNodeId(n.id)}
                                >
                                  <div class="flex items-center justify-between gap-2">
                                    <div class="min-w-0">
                                      <div class="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{n.name}</div>
                                      <div class="mt-0.5 truncate font-mono text-[11px] text-slate-500">{n.endpoint}</div>
                                    </div>
                                    <span
                                      class={`h-2 w-2 rounded-full ${
                                        n.last_error ? 'bg-rose-500' : n.last_seen_at ? 'bg-emerald-400' : 'bg-slate-500'
                                      }`}
                                    />
                                  </div>
                                </button>
                              )}
                            </For>
                          </div>
                        </Show>
                      </Show>
                    </div>
                  }
                  right={
                    <>
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Details</div>
                      </div>

                      <div class="mt-3 rounded-xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <Show
                          when={nodes.isError}
                          fallback={
                            <Show
                              when={(nodes.data ?? []).length > 0}
                              fallback={<EmptyState title="No nodes" description="There are no nodes to show." />}
                            >
                              <Show
                                when={selectedNode()}
                                fallback={<EmptyState title="Select a node" description="Pick a node from the left to view details." />}
                              >
                                {(n) => (
                                  <div>
                                    <div class="flex items-center justify-between gap-3">
                                      <div class="min-w-0">
                                        <div class="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{n().name}</div>
                                        <div class="mt-0.5 truncate font-mono text-[11px] text-slate-500">{n().endpoint}</div>
                                        <Show when={me()?.is_admin && selectedNodeId() === n().id}>
                                          <div class="mt-1">
                                            <Show when={nodeSelfUpdateStatus.isPending}>
                                              <span class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
                                                Checking updater…
                                              </span>
                                            </Show>
                                            <Show when={!nodeSelfUpdateStatus.isPending && !nodeSelfUpdateStatus.isError && nodeSelfUpdateStatus.data}>
                                              <span
                                                class={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${
                                                  nodeSelfUpdateStatus.data?.configured
                                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300'
                                                    : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300'
                                                }`}
                                                title={nodeSelfUpdateStatus.data?.endpoint ?? ''}
                                              >
                                                {nodeSelfUpdateStatus.data?.configured ? 'Updater configured' : 'Updater not configured'}
                                              </span>
                                            </Show>
                                            <Show when={!nodeSelfUpdateStatus.isPending && !nodeSelfUpdateStatus.isError && nodeSelfUpdateStatus.data}>
                                              <div class="mt-1 truncate font-mono text-[10px] text-slate-500 dark:text-slate-400" title={nodeSelfUpdateStatus.data?.endpoint ?? ''}>
                                                {(nodeSelfUpdateStatus.data?.provider || 'watchtower').toLowerCase()} · {nodeSelfUpdateStatus.data?.endpoint || '-'}
                                              </div>
                                            </Show>

                                            <Show when={updateCheck.isPending}>
                                              <span class="mt-1 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
                                                Checking target version…
                                              </span>
                                            </Show>

                                            <Show when={!updateCheck.isPending && updateCheck.data?.agent_latest}>
                                              {(agentLatest) => (
                                                <div class="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                                                  <span class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
                                                    Target {agentLatest().tag}
                                                  </span>
                                                  <Show when={nodeAgentUpdateState(n()).updateAvailable === true}>
                                                    <span class="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
                                                      Update available
                                                    </span>
                                                  </Show>
                                                  <Show when={nodeAgentUpdateState(n()).updateAvailable === false}>
                                                    <span class="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">
                                                      Agent up to date
                                                    </span>
                                                  </Show>
                                                  <Show when={nodeAgentUpdateState(n()).updateAvailable == null}>
                                                    <span class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
                                                      Version compare unavailable
                                                    </span>
                                                  </Show>
                                                </div>
                                              )}
                                            </Show>

                                            <Show when={!nodeSelfUpdateStatus.isPending && nodeSelfUpdateStatus.isError}>
                                              <span class="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
                                                Updater check failed
                                              </span>
                                            </Show>
                                          </div>
                                        </Show>
                                      </div>
                                      <div class="flex flex-wrap items-center justify-end gap-2">
                                        <Show when={me()?.is_admin}>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant={nodeAgentUpdateState(n()).updateAvailable === true ? 'primary' : 'secondary'}
                                            loading={triggerNodeSelfUpdate.isPending}
                                            disabled={triggerNodeSelfUpdate.isPending || Boolean(nodeUpdateDisabledReason(n()))}
                                            title={nodeUpdateButtonTitle(n())}
                                            onClick={async () => {
                                              try {
                                                const out = await triggerNodeSelfUpdate.mutateAsync({ node_id: n().id })
                                                pushToast('success', 'Update triggered', out.message || `Node ${n().name} update requested.`)
                                                if (out.status?.endpoint) {
                                                  pushToast('info', 'Updater endpoint', out.status.endpoint)
                                                }
                                                setTimeout(() => {
                                                  void invalidateNodes()
                                                  void nodeSelfUpdateStatus.refetch()
                                                }, 2500)
                                              } catch (e) {
                                                if (isAlloyApiError(e) && e.data.hint) {
                                                  pushToast('info', 'Hint', e.data.hint, e.data.request_id)
                                                }
                                                toastError('Node update failed', e)
                                              }
                                            }}
                                          >
                                            {nodeUpdateButtonLabel(n())}
                                          </Button>

                                          <button
                                            type="button"
                                            disabled={setNodeEnabled.isPending}
                                            class="group inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/60 px-2 py-1.5 text-[11px] text-slate-700 shadow-sm hover:bg-white disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 dark:shadow-none dark:hover:bg-slate-900"
                                            onClick={async () => {
                                              const id = n().id
                                              const current =
                                                Object.prototype.hasOwnProperty.call(nodeEnabledOverride(), id)
                                                  ? nodeEnabledOverride()[id]
                                                  : n().enabled
                                              const next = !current
                                              setNodeEnabledOverride({ ...nodeEnabledOverride(), [id]: next })
                                              try {
                                                await setNodeEnabled.mutateAsync({ node_id: id, enabled: next })
                                                void invalidateNodes()
                                              } catch {
                                                setNodeEnabledOverride({ ...nodeEnabledOverride(), [id]: current })
                                              }
                                            }}
                                          >
                                            <span class="text-slate-500 dark:text-slate-500">Enabled</span>
                                            <span
                                              class={`relative inline-flex h-5 w-9 items-center rounded-full border transition-colors ${
                                                (Object.prototype.hasOwnProperty.call(nodeEnabledOverride(), n().id)
                                                  ? nodeEnabledOverride()[n().id]
                                                  : n().enabled)
                                                  ? 'border-emerald-200 bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/20'
                                                  : 'border-slate-300 bg-slate-200 dark:border-slate-700 dark:bg-slate-900/40'
                                              }`}
                                            >
                                              <span
                                                class={`inline-block h-4 w-4 transform rounded-full bg-slate-100 shadow transition-transform ${
                                                  (Object.prototype.hasOwnProperty.call(nodeEnabledOverride(), n().id)
                                                    ? nodeEnabledOverride()[n().id]
                                                    : n().enabled)
                                                    ? 'translate-x-4'
                                                    : 'translate-x-1'
                                                }`}
                                              />
                                            </span>
                                          </button>
                                        </Show>
                                      </div>
                                    </div>

                                    <div class="mt-4 grid grid-cols-2 gap-3 text-xs">
                                      <div>
                                        <div class="text-[11px] text-slate-500">Status</div>
                                        <div class="mt-1 text-slate-700 dark:text-slate-200">{n().last_error ? 'Error' : n().last_seen_at ? 'Healthy' : 'Unknown'}</div>
                                      </div>
                                      <div>
                                        <div class="text-[11px] text-slate-500">Agent current</div>
                                        <div class="mt-1 text-slate-700 dark:text-slate-200">{n().agent_version ?? '-'}</div>
                                      </div>
                                      <div>
                                        <div class="text-[11px] text-slate-500">Agent target</div>
                                        <div class="mt-1 text-slate-700 dark:text-slate-200">{nodeAgentUpdateState(n()).targetTag ?? '-'}</div>
                                      </div>
                                      <div>
                                        <div class="text-[11px] text-slate-500">Agent update</div>
                                        <div class="mt-1 text-slate-700 dark:text-slate-200">
                                          {nodeAgentUpdateState(n()).updateAvailable === true
                                            ? 'Available'
                                            : nodeAgentUpdateState(n()).updateAvailable === false
                                              ? 'Up to date'
                                              : 'Unknown'}
                                        </div>
                                      </div>
                                      <div class="col-span-2">
                                        <div class="text-[11px] text-slate-500">Last seen</div>
                                        <div class="mt-1 font-mono text-[11px] text-slate-700 dark:text-slate-200">{n().last_seen_at ?? '-'}</div>
                                      </div>
                                      <div class="col-span-2">
                                        <div class="text-[11px] text-slate-500">Last error</div>
                                        <div class="mt-1 font-mono text-[11px] text-rose-700 dark:text-rose-300">{n().last_error ?? '-'}</div>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </Show>
                            </Show>
                          }
                        >
                          <ErrorState title="Failed to load nodes" error={nodes.error} onRetry={() => void invalidateNodes()} />
                        </Show>
                      </div>
                    </>
                  }
                />
              </Show>
  )
}
