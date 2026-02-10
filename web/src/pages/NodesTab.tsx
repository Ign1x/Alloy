import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import { isVersionLower } from '../app/helpers/version'
import { formatRelativeTime } from '../app/helpers/format'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { IconButton } from '../components/ui/IconButton'
import { Skeleton } from '../components/ui/Skeleton'
import { isAlloyApiError } from '../rspc'
import NodesPage from './NodesPage'

export type NodesTabProps = {
  tab: () => string
  [key: string]: unknown
}

type NodeRow = {
  id: string
  name: string
  endpoint: string
  enabled: boolean
  last_seen_at: string | null
  agent_version: string | null
  last_error: string | null
}

type TriggerNodeUpdateOptions = {
  notifySuccess?: boolean
  notifyErrors?: boolean
  notifyEndpoint?: boolean
}

type TriggerNodeUpdateResult =
  | { ok: true }
  | { ok: false; errorText: string }

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

  const [bulkSelection, setBulkSelection] = createSignal<Record<string, boolean>>({})
  const [bulkUpdatePending, setBulkUpdatePending] = createSignal(false)
  const [updatingNodeIds, setUpdatingNodeIds] = createSignal<Record<string, boolean>>({})

  const nodeList = createMemo(() => (nodes.data ?? []) as NodeRow[])

  createEffect(() => {
    const ids = new Set(nodeList().map((node) => node.id))

    setBulkSelection((prev) => {
      let changed = false
      const next: Record<string, boolean> = {}
      for (const [id, selected] of Object.entries(prev)) {
        if (!selected) continue
        if (ids.has(id)) {
          next[id] = true
          continue
        }
        changed = true
      }
      if (!changed && Object.keys(next).length === Object.keys(prev).length) return prev
      return next
    })

    setUpdatingNodeIds((prev) => {
      let changed = false
      const next: Record<string, boolean> = {}
      for (const [id, updating] of Object.entries(prev)) {
        if (!updating) continue
        if (ids.has(id)) {
          next[id] = true
          continue
        }
        changed = true
      }
      if (!changed && Object.keys(next).length === Object.keys(prev).length) return prev
      return next
    })
  })

  function nodeAgentUpdateState(node: { agent_version: string | null | undefined }) {
    const target = updateCheck.data?.agent_latest
    if (!target) {
      return {
        targetTag: null as string | null,
        updateAvailable: null as boolean | null,
      }
    }

    return {
      targetTag: target.tag,
      updateAvailable: isVersionLower(node.agent_version, target.version ?? target.tag),
    }
  }

  const selectedNodeIds = createMemo(() =>
    Object.entries(bulkSelection())
      .filter(([, selected]) => selected)
      .map(([id]) => id),
  )

  const selectedNodeCount = createMemo(() => selectedNodeIds().length)

  const outdatedNodeIds = createMemo(() => {
    const out: string[] = []
    for (const node of nodeList()) {
      if (nodeAgentUpdateState(node).updateAvailable === true) out.push(node.id)
    }
    return out
  })

  const outdatedNodeCount = createMemo(() => outdatedNodeIds().length)

  const selectedNodes = createMemo(() => {
    const ids = new Set(selectedNodeIds())
    return nodeList().filter((node) => ids.has(node.id))
  })

  const selectedEnabledNodes = createMemo(() => selectedNodes().filter((node) => node.enabled))
  const selectedDisabledNodes = createMemo(() => selectedNodes().filter((node) => !node.enabled))

  const batchActionsBusy = createMemo(() => bulkUpdatePending() || triggerNodeSelfUpdate.isPending)

  function isNodeSelected(nodeId: string): boolean {
    return Boolean(bulkSelection()[nodeId])
  }

  function setNodeSelected(nodeId: string, selected: boolean) {
    setBulkSelection((prev) => {
      if (selected && prev[nodeId]) return prev
      if (!selected && !prev[nodeId]) return prev
      const next = { ...prev }
      if (selected) next[nodeId] = true
      else delete next[nodeId]
      return next
    })
  }

  function selectAllNodes() {
    const next: Record<string, boolean> = {}
    for (const node of nodeList()) next[node.id] = true
    setBulkSelection(next)
  }

  function selectOutdatedNodes() {
    const next: Record<string, boolean> = {}
    for (const nodeId of outdatedNodeIds()) next[nodeId] = true
    setBulkSelection(next)
  }

  function clearBulkSelection() {
    setBulkSelection({})
  }

  function setNodeUpdating(nodeId: string, updating: boolean) {
    setUpdatingNodeIds((prev) => {
      if (updating && prev[nodeId]) return prev
      if (!updating && !prev[nodeId]) return prev
      const next = { ...prev }
      if (updating) next[nodeId] = true
      else delete next[nodeId]
      return next
    })
  }

  function shortNames(nodesToShow: NodeRow[], max = 3): string {
    const names = nodesToShow.map((node) => node.name)
    if (names.length <= max) return names.join(', ')
    return `${names.slice(0, max).join(', ')}…`
  }

  async function requestNodeUpdate(node: NodeRow, options: TriggerNodeUpdateOptions = {}): Promise<TriggerNodeUpdateResult> {
    const { notifySuccess = true, notifyErrors = true, notifyEndpoint = true } = options
    setNodeUpdating(node.id, true)
    try {
      const out = await triggerNodeSelfUpdate.mutateAsync({ node_id: node.id })
      if (notifySuccess) {
        pushToast('success', 'Update triggered', out.message || `Node ${node.name} update requested.`)
      }
      if (notifyEndpoint && out.status?.endpoint) {
        pushToast('info', 'Updater endpoint', out.status.endpoint)
      }
      return { ok: true }
    } catch (error) {
      const errorText = isAlloyApiError(error)
        ? error.data.message
        : error instanceof Error
          ? error.message
          : 'unknown error'

      if (notifyErrors) {
        if (isAlloyApiError(error) && error.data.hint) {
          pushToast('info', 'Hint', error.data.hint, error.data.request_id)
        }
        toastError('Node update failed', error)
      }

      return { ok: false, errorText }
    } finally {
      setNodeUpdating(node.id, false)
    }
  }

  async function triggerSelectedNodeUpdates() {
    if (batchActionsBusy()) return

    const selected = selectedNodes()
    if (!selected.length) {
      pushToast('info', 'No nodes selected', 'Select one or more nodes first.')
      return
    }

    const enabledNodes = selectedEnabledNodes()
    const disabledNodes = selectedDisabledNodes()

    if (!enabledNodes.length) {
      pushToast('info', 'No eligible nodes', 'Selected nodes are disabled. Enable them first.')
      return
    }

    setBulkUpdatePending(true)
    let successCount = 0
    const failedNodes: Array<{ name: string; errorText: string }> = []

    for (const node of enabledNodes) {
      const result = await requestNodeUpdate(node, {
        notifySuccess: false,
        notifyErrors: false,
        notifyEndpoint: false,
      })
      if (result.ok) {
        successCount++
        continue
      }
      failedNodes.push({ name: node.name, errorText: result.errorText })
    }

    setBulkUpdatePending(false)

    if (successCount > 0) {
      pushToast('success', 'Batch update triggered', `${successCount}/${enabledNodes.length} node(s) accepted update request.`)
    }

    if (failedNodes.length > 0) {
      pushToast(
        'error',
        'Batch update failed',
        `${failedNodes.length} node(s) failed: ${failedNodes.slice(0, 3).map((node) => node.name).join(', ')}${failedNodes.length > 3 ? '…' : ''}`,
      )
    }

    if (disabledNodes.length > 0) {
      pushToast('info', 'Skipped disabled nodes', shortNames(disabledNodes))
    }

    if (failedNodes.length === 0) {
      clearBulkSelection()
    }

    void invalidateNodes()
    void nodeSelfUpdateStatus.refetch()
  }

  function nodeUpdateDisabledReason(node: { id: string; enabled: boolean }): string | null {
    if (batchActionsBusy()) return 'Another update is already running'
    if (updatingNodeIds()[node.id]) return 'Update in progress'
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

            <Show when={me()?.is_admin && !nodes.isError && !nodes.isPending && nodeList().length > 0}>
              <div class="rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>
                    Selected <span class="font-medium text-slate-700 dark:text-slate-200">{selectedNodeCount()}</span> / {nodeList().length}
                  </span>
                  <span>
                    Outdated <span class="font-medium text-amber-700 dark:text-amber-300">{outdatedNodeCount()}</span>
                  </span>
                </div>

                <div class="mt-2 flex flex-wrap items-center gap-2">
                  <Button size="xs" variant="secondary" disabled={batchActionsBusy() || outdatedNodeCount() === 0} onClick={selectOutdatedNodes}>
                    Select outdated
                  </Button>
                  <Button size="xs" variant="secondary" disabled={batchActionsBusy() || nodeList().length === 0} onClick={selectAllNodes}>
                    Select all
                  </Button>
                  <Button size="xs" variant="secondary" disabled={batchActionsBusy() || selectedNodeCount() === 0} onClick={clearBulkSelection}>
                    Clear
                  </Button>
                  <Button
                    size="xs"
                    variant="primary"
                    loading={bulkUpdatePending()}
                    disabled={batchActionsBusy() || selectedNodeCount() === 0}
                    title={selectedNodeCount() === 0 ? 'Select one or more nodes first' : 'Trigger self update for selected nodes'}
                    onClick={async () => {
                      await triggerSelectedNodeUpdates()
                    }}
                  >
                    Update selected ({selectedNodeCount()})
                  </Button>
                </div>
              </div>
            </Show>

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
                when={!nodes.isPending && nodeList().length > 0}
                fallback={
                  <Show when={!nodes.isPending}>
                    <EmptyState title="No nodes" />
                  </Show>
                }
              >
                <div class="max-h-96 overflow-auto rounded-xl border border-slate-200 bg-white/60 p-1 dark:border-slate-800 dark:bg-slate-950/40">
                  <For each={nodeList()}>
                    {(node) => (
                      <div class="flex items-center gap-1 rounded-lg px-1 py-1">
                        <Show when={me()?.is_admin}>
                          <input
                            type="checkbox"
                            class="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500/35 dark:border-slate-700 dark:bg-slate-900"
                            checked={isNodeSelected(node.id)}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => setNodeSelected(node.id, event.currentTarget.checked)}
                            title="Select for batch update"
                          />
                        </Show>

                        <button
                          type="button"
                          class={`min-w-0 flex-1 rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-900 ${
                            selectedNodeId() === node.id ? 'bg-slate-100 dark:bg-slate-900' : ''
                          }`}
                          onClick={() => setSelectedNodeId(node.id)}
                        >
                          <div class="flex items-center justify-between gap-2">
                            <div class="min-w-0">
                              <div class="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{node.name}</div>
                              <div class="mt-0.5 truncate font-mono text-[11px] text-slate-500">{node.endpoint}</div>
                            </div>
                            <span
                              class={`h-2 w-2 rounded-full ${
                                node.last_error ? 'bg-rose-500' : node.last_seen_at ? 'bg-emerald-400' : 'bg-slate-500'
                              }`}
                            />
                          </div>
                        </button>
                      </div>
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
                  <Show when={nodeList().length > 0} fallback={<EmptyState title="No nodes" />}>
                    <Show
                      when={selectedNode()}
                      fallback={<EmptyState title="Select a node" />}
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
                                  loading={Boolean(updatingNodeIds()[n().id])}
                                  disabled={Boolean(nodeUpdateDisabledReason(n()))}
                                  title={nodeUpdateButtonTitle(n())}
                                  onClick={async () => {
                                    const result = await requestNodeUpdate(n(), {
                                      notifySuccess: true,
                                      notifyErrors: true,
                                      notifyEndpoint: true,
                                    })
                                    if (result.ok) {
                                      setTimeout(() => {
                                        void invalidateNodes()
                                        void nodeSelfUpdateStatus.refetch()
                                      }, 2500)
                                    }
                                  }}
                                >
                                  {nodeUpdateButtonLabel(n())}
                                </Button>

                                <button
                                  type="button"
                                  disabled={setNodeEnabled.isPending || batchActionsBusy()}
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
