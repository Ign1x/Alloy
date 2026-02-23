import { Show, createEffect, createMemo, createSignal } from 'solid-js'
import { isVersionLower } from '../app/helpers/version'
import { parseU64 } from '../app/helpers/format'
import { useSearchFocusShortcut } from '../app/helpers/searchFocusShortcut'
import type { I18nTranslate } from '../app/i18n'
import { isAlloyApiError } from '../rspc'
import NodesPage from './NodesPage'
import NodeDetailPanel from './nodes/NodeDetailPanel'
import NodesFleetPanel from './nodes/NodesFleetPanel'
import DeleteNodeModal from './nodes/DeleteNodeModal'
import TriggerNodeUpdateModal from './nodes/TriggerNodeUpdateModal'
import { nodeHealthStatus } from './nodes/nodeStatus'

export type NodesTabProps = {
  tab: () => string
  t: I18nTranslate
  [key: string]: unknown
}

export type NodeRow = {
  id: string
  name: string
  endpoint: string
  enabled: boolean
  last_seen_at: string | null
  agent_version: string | null
  last_error: string | null
  cpu_percent_x100?: number | null
  memory_used_bytes?: string | null
  memory_total_bytes?: string | null
  network_rx_bytes_per_sec?: string | null
  network_tx_bytes_per_sec?: string | null
  disk_read_bytes_per_sec?: string | null
  disk_write_bytes_per_sec?: string | null
}

type TriggerNodeUpdateOptions = {
  notifySuccess?: boolean
  notifyErrors?: boolean
  notifyEndpoint?: boolean
}

type TriggerNodeUpdateResult =
  | { ok: true }
  | { ok: false; errorText: string }

function isNodeTunnelDisconnectedError(error: unknown): boolean {
  const text = isAlloyApiError(error)
    ? `${error.data.message} ${error.data.hint ?? ''}`.toLowerCase()
    : error instanceof Error
      ? error.message.toLowerCase()
      : ''
  return text.includes('node tunnel disconnected') || text.includes('node is currently unreachable')
}

export default function NodesTab(props: NodesTabProps) {
  const {
    tab,
    t,
    me,
    openCreateNode,
    nodesLastUpdatedAtUnixMs,
    nodes,
    invalidateNodes,
    selectedNodeId,
    setSelectedNodeId,
    selectedNode,
    setNodeEnabled,
    deleteNode,
    triggerNodeSelfUpdate,
    nodeSelfUpdateStatus,
    nodeEnabledOverride,
    setNodeEnabledOverride,
    updateCheck,
    openSettingsTab,
    pushToast,
    toastError,
  } = props as any

  const [bulkSelection, setBulkSelection] = createSignal<Record<string, boolean>>({})
  const [bulkUpdatePending, setBulkUpdatePending] = createSignal(false)
  const [updatingNodeIds, setUpdatingNodeIds] = createSignal<Record<string, boolean>>({})
  const [deletingNodeId, setDeletingNodeId] = createSignal<string | null>(null)
  const [confirmDeleteNodeId, setConfirmDeleteNodeId] = createSignal<string | null>(null)
  const [confirmDeleteNodeText, setConfirmDeleteNodeText] = createSignal('')
  const [confirmUpdateMode, setConfirmUpdateMode] = createSignal<'single' | 'batch' | null>(null)
  const [nodeUpdateErrorCooldownUntil, setNodeUpdateErrorCooldownUntil] = createSignal<Record<string, number>>({})
  const [nodesPollErrorStreak, setNodesPollErrorStreak] = createSignal(0)

  const nodeList = createMemo(() => (nodes.data ?? []) as NodeRow[])

  createEffect(() => {
    const error = nodes.error
    if (nodes.isError && error) {
      setNodesPollErrorStreak((prev) => Math.min(prev + 1, 6))
      return
    }
    setNodesPollErrorStreak(0)
  })

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
    const toastContext = { scope: 'node' as const, id: node.id, label: node.name }
    setNodeUpdating(node.id, true)
    try {
      const out = await triggerNodeSelfUpdate.mutateAsync({ node_id: node.id })
      if (notifySuccess) {
        pushToast('success', t('nodes.updateTriggered'), out.message || t('nodes.nodeUpdateRequested', { name: node.name }), undefined, {
          context: toastContext,
        })
      }
      if (notifyEndpoint && out.status?.endpoint) {
        pushToast('info', t('nodes.updaterEndpoint'), out.status.endpoint, undefined, {
          context: toastContext,
        })
      }
      return { ok: true }
    } catch (error) {
      const errorText = isAlloyApiError(error)
        ? error.data.message
        : error instanceof Error
          ? error.message
          : t('nodes.unknownError')

      if (notifyErrors) {
        const disconnected = isNodeTunnelDisconnectedError(error)
        if (disconnected) {
          const now = Date.now()
          const cooldownUntil = nodeUpdateErrorCooldownUntil()[node.id] ?? 0
          if (now >= cooldownUntil) {
            pushToast('info', t('nodes.nodeReconnecting'), t('nodes.nodeTunnelDisconnectedRetry'), undefined, {
              context: toastContext,
            })
            setNodeUpdateErrorCooldownUntil((prev) => ({
              ...prev,
              [node.id]: now + 15_000,
            }))
          }
        } else {
          if (isAlloyApiError(error) && error.data.hint) {
            pushToast('info', t('nodes.hint'), error.data.hint, error.data.request_id, {
              context: toastContext,
            })
          }
          toastError(t('nodes.nodeUpdateFailed'), error, {
            context: toastContext,
            retry: { key: `node.update:${node.id}` },
            onRetry: () => requestNodeUpdate(node, options).then(() => undefined),
          })
        }
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
      pushToast('info', t('nodes.noNodesSelected'), t('nodes.selectOneOrMoreFirst'))
      return
    }

    const enabledNodes = selectedEnabledNodes()

    if (!enabledNodes.length) {
      pushToast('info', t('nodes.noEligibleNodes'), t('nodes.selectedNodesDisabledEnableFirst'))
      return
    }

    setConfirmUpdateMode('batch')
  }

  async function confirmBatchNodeUpdates() {
    if (batchActionsBusy()) return

    const selected = selectedNodes()
    if (!selected.length) {
      setConfirmUpdateMode(null)
      return
    }

    const enabledNodes = selectedEnabledNodes()
    const disabledNodes = selectedDisabledNodes()
    if (!enabledNodes.length) {
      setConfirmUpdateMode(null)
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
      pushToast('success', t('nodes.batchUpdateTriggered'), t('nodes.batchUpdateAccepted', { success: successCount, total: enabledNodes.length }), undefined, {
        context: { scope: 'node', label: shortNames(enabledNodes) },
      })
    }

    if (failedNodes.length > 0) {
      pushToast(
        'error',
        t('nodes.batchUpdateFailed'),
        t('nodes.batchUpdateFailedNodes', {
          count: failedNodes.length,
          names: `${failedNodes
            .slice(0, 3)
            .map((node) => node.name)
            .join(', ')}${failedNodes.length > 3 ? '…' : ''}`,
        }),
        undefined,
        {
          context: { scope: 'node', label: shortNames(enabledNodes) },
        },
      )
    }

    if (disabledNodes.length > 0) {
      pushToast('info', t('nodes.skippedDisabledNodes'), shortNames(disabledNodes), undefined, {
        context: { scope: 'node', label: shortNames(disabledNodes) },
      })
    }

    if (failedNodes.length === 0) {
      clearBulkSelection()
    }

    void invalidateNodes()
    void nodeSelfUpdateStatus.refetch()

    setConfirmUpdateMode(null)
  }

  function nodeDeleteDisabledReason(node: { id: string }): string | null {
    if (batchActionsBusy()) return t('nodes.anotherUpdateRunning')
    if (Boolean(deletingNodeId())) return t('nodes.deleteInProgress')
    if (Boolean(updatingNodeIds()[node.id])) return t('nodes.updateInProgress')
    if (selectedNodeId() !== node.id) return t('nodes.selectNodeFirst')
    return null
  }

  async function requestNodeDelete(node: NodeRow) {
    if (nodeDeleteDisabledReason(node)) return

    setConfirmDeleteNodeId(node.id)
  }

  async function confirmDeleteNode(nodeId: string) {
    const node = nodeList().find((n) => n.id === nodeId)
    if (!node) {
      setConfirmDeleteNodeId(null)
      return
    }

    if (nodeDeleteDisabledReason(node)) return

    setDeletingNodeId(node.id)
    try {
      await deleteNode.mutateAsync({ node_id: node.id })

      pushToast('success', t('nodes.nodeDeleted'), t('nodes.nodeRemoved', { name: node.name }), undefined, {
        context: { scope: 'node', id: node.id, label: node.name },
      })
      if (selectedNodeId() === node.id) setSelectedNodeId(null)

      setBulkSelection((prev) => {
        if (!prev[node.id]) return prev
        const next = { ...prev }
        delete next[node.id]
        return next
      })
      setUpdatingNodeIds((prev) => {
        if (!prev[node.id]) return prev
        const next = { ...prev }
        delete next[node.id]
        return next
      })
      setNodeEnabledOverride((prev: Record<string, boolean>) => {
        if (!Object.prototype.hasOwnProperty.call(prev, node.id)) return prev
        const next = { ...prev }
        delete next[node.id]
        return next
      })

      await invalidateNodes()
      if (selectedNodeId() === null) {
        const next = filteredNodeList().find((item) => item.id !== node.id)
        if (next) setSelectedNodeId(next.id)
      }
    } catch (error) {
      if (isAlloyApiError(error) && error.data.hint) {
        pushToast('info', t('nodes.hint'), error.data.hint, error.data.request_id, {
          context: { scope: 'node', id: node.id, label: node.name },
        })
      }
      toastError(t('nodes.nodeDeleteFailed'), error, {
        context: { scope: 'node', id: node.id, label: node.name },
        retry: { key: `node.delete:${node.id}` },
        onRetry: () => confirmDeleteNode(node.id),
      })
    } finally {
      setDeletingNodeId(null)
    }

    setConfirmDeleteNodeId(null)
  }

  function nodeUpdateDisabledReason(node: { id: string; enabled: boolean }): string | null {
    if (batchActionsBusy()) return t('nodes.anotherUpdateRunning')
    if (updatingNodeIds()[node.id]) return t('nodes.updateInProgress')
    if (!node.enabled) return t('nodes.enableNodeFirst')
    if (selectedNodeId() !== node.id) return t('nodes.selectNodeFirst')
    if (nodeSelfUpdateStatus.isPending) return t('nodes.checkingNodeUpdaterStatus')
    if (nodeSelfUpdateStatus.isError) return t('nodes.updaterStatusUnavailable')
    if (!nodeSelfUpdateStatus.data?.configured) return t('nodes.nodeUpdaterNotConfigured')
    return null
  }

  function nodeUpdateButtonLabel(node: { agent_version: string | null | undefined }): string {
    const state = nodeAgentUpdateState(node)
    if (state.updateAvailable === false) return t('nodes.rerunUpdate')
    return t('nodes.updateNode')
  }

  function nodeUpdateButtonTitle(node: { id: string; enabled: boolean; agent_version: string | null | undefined }): string {
    const disabled = nodeUpdateDisabledReason(node)
    if (disabled) return disabled
    const state = nodeAgentUpdateState(node)
    if (state.updateAvailable === false) {
      return t('nodes.nodeAgentAlreadyUpToDate')
    }
    if (state.targetTag) {
      return t('nodes.triggerNodeSelfUpdateTarget', { target: state.targetTag })
    }
    return t('nodes.triggerNodeSelfUpdate')
  }

  function parseResourceMetric(value: string | null | undefined): number | null {
    return parseU64(value)
  }

  const nodeSearchStorageKey = 'alloy.nodes.search.v1'
  const [nodeSearchInput, setNodeSearchInput] = createSignal('')
  const [nodeSearch, setNodeSearch] = createSignal('')
  let nodeSearchInputEl: HTMLInputElement | undefined

  createEffect(() => {
    const handle = window.setTimeout(() => {
      setNodeSearch(nodeSearchInput().trim().toLowerCase())
    }, 120)
    return () => window.clearTimeout(handle)
  })

  createEffect(() => {
    try {
      const raw = localStorage.getItem(nodeSearchStorageKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as { q?: unknown }
      if (typeof parsed.q === 'string') setNodeSearchInput(parsed.q)
    } catch {}
  })

  createEffect(() => {
    try {
      localStorage.setItem(nodeSearchStorageKey, JSON.stringify({ q: nodeSearchInput() }))
    } catch {}
  })

  createEffect(() => {
    useSearchFocusShortcut({
      input: () => nodeSearchInputEl,
      queryValue: () => nodeSearchInput(),
      clearQuery: () => setNodeSearchInput(''),
    })
  })

  const filteredNodeList = createMemo(() => {
    const q = nodeSearch()
    const rows = nodeList()
    if (!q) return rows
    return rows.filter((n) => {
      const status = nodeHealthStatus(n)
      const haystack = `${n.name} ${n.endpoint} ${n.agent_version ?? ''} ${status}`.toLowerCase()
      return haystack.includes(q)
    })
  })

  const healthyNodeCount = createMemo(() => nodeList().filter((n) => nodeHealthStatus(n) === 'healthy').length)
  const errorNodeCount = createMemo(() => nodeList().filter((n) => nodeHealthStatus(n) === 'error').length)
  const unknownNodeCount = createMemo(() => nodeList().filter((n) => nodeHealthStatus(n) === 'unknown').length)
  const showStaleSnapshot = createMemo(() => nodes.isError && nodeList().length > 0 && nodesPollErrorStreak() >= 2)

  createEffect(() => {
    const available = new Set(filteredNodeList().map((n) => n.id))
    setBulkSelection((prev) => {
      const next: Record<string, boolean> = {}
      let changed = false
      for (const [id, selected] of Object.entries(prev)) {
        if (!selected) continue
        if (available.has(id)) next[id] = true
        else changed = true
      }
      if (!changed && Object.keys(next).length === Object.keys(prev).length) return prev
      return next
    })
  })

  return (
    <Show when={tab() === 'nodes'}>
      <>
        <NodesPage
          tabLabel={t('tab.nodes')}
          left={
            <NodesFleetPanel
              t={t}
              meIsAdmin={Boolean(me()?.is_admin)}
              onOpenCreateNode={() => openCreateNode()}
              nodeList={nodeList()}
              healthyNodeCount={healthyNodeCount()}
              errorNodeCount={errorNodeCount()}
              unknownNodeCount={unknownNodeCount()}
              nodesLastUpdatedAtUnixMs={nodesLastUpdatedAtUnixMs()}
              nodesIsPending={nodes.isPending}
              nodesIsError={nodes.isError}
              nodesError={nodes.error}
              onRetryNodes={() => void invalidateNodes()}
              onOpenSettings={openSettingsTab}
              filteredNodeList={filteredNodeList()}
              nodeSearch={nodeSearch()}
              nodeSearchInput={nodeSearchInput()}
              setNodeSearchInput={setNodeSearchInput}
              setNodeSearchInputEl={(el) => {
                nodeSearchInputEl = el
              }}
              onSelectNode={setSelectedNodeId}
              selectedNodeId={selectedNodeId()}
              selectedNodeCount={selectedNodeCount()}
              outdatedNodeCount={outdatedNodeCount()}
              selectedNodesShortNames={shortNames(selectedNodes())}
              batchActionsBusy={batchActionsBusy()}
              onSelectOutdatedNodes={selectOutdatedNodes}
              onSelectAllNodes={selectAllNodes}
              onClearBulkSelection={clearBulkSelection}
              onTriggerSelectedNodeUpdates={triggerSelectedNodeUpdates}
              bulkUpdatePending={bulkUpdatePending()}
              isNodeSelected={isNodeSelected}
              setNodeSelected={setNodeSelected}
              isNodeUpdating={(nodeId) => Boolean(updatingNodeIds()[nodeId])}
              showStaleSnapshot={showStaleSnapshot()}
            />
          }
          right={
            <NodeDetailPanel
              t={t}
              meIsAdmin={Boolean(me()?.is_admin)}
              nodesIsPending={nodes.isPending}
              nodesIsError={nodes.isError}
              nodesError={nodes.error}
              onRetryNodes={() => void invalidateNodes()}
              onOpenSettings={openSettingsTab}
              nodeListLength={nodeList().length}
              selectedNode={selectedNode() as NodeRow | null}
              selectedNodeId={selectedNodeId()}
              updaterChecking={nodeSelfUpdateStatus.isPending}
              updaterCheckFailed={nodeSelfUpdateStatus.isError}
              updaterConfigured={Boolean(nodeSelfUpdateStatus.data?.configured)}
              updaterEndpoint={nodeSelfUpdateStatus.data?.endpoint ?? ''}
              updaterProvider={nodeSelfUpdateStatus.data?.provider || 'watchtower'}
              updateCheckPending={updateCheck.isPending}
              agentLatestTag={updateCheck.data?.agent_latest?.tag ?? null}
              agentUpdateAvailable={selectedNode() ? nodeAgentUpdateState(selectedNode() as NodeRow).updateAvailable : null}
              onUpdateNode={async () => {
                const node = selectedNode() as NodeRow | null
                if (!node) return
                setConfirmUpdateMode('single')
              }}
              onDeleteNode={async () => {
                const node = selectedNode() as NodeRow | null
                if (!node) return
                await requestNodeDelete(node)
              }}
              onToggleEnabled={async () => {
                const node = selectedNode() as NodeRow | null
                if (!node) return
                const id = node.id
                const current = Object.prototype.hasOwnProperty.call(nodeEnabledOverride(), id) ? nodeEnabledOverride()[id] : node.enabled
                const next = !current
                setNodeEnabledOverride({ ...nodeEnabledOverride(), [id]: next })
                try {
                  await setNodeEnabled.mutateAsync({ node_id: id, enabled: next })
                  void invalidateNodes()
                } catch {
                  setNodeEnabledOverride({ ...nodeEnabledOverride(), [id]: current })
                }
              }}
              updateButtonVariant={selectedNode() && nodeAgentUpdateState(selectedNode() as NodeRow).updateAvailable === true ? 'primary' : 'secondary'}
              updateButtonLoading={Boolean(selectedNode() && updatingNodeIds()[(selectedNode() as NodeRow).id])}
              updateButtonDisabled={Boolean(selectedNode() && nodeUpdateDisabledReason(selectedNode() as NodeRow))}
              updateButtonTitle={selectedNode() ? nodeUpdateButtonTitle(selectedNode() as NodeRow) : ''}
              updateButtonLabel={selectedNode() ? nodeUpdateButtonLabel(selectedNode() as NodeRow) : t('nodes.updateNode')}
              deleteButtonLoading={Boolean(selectedNode() && deletingNodeId() === (selectedNode() as NodeRow).id)}
              deleteButtonDisabled={Boolean(selectedNode() && nodeDeleteDisabledReason(selectedNode() as NodeRow))}
              deleteButtonTitle={selectedNode() ? (nodeDeleteDisabledReason(selectedNode() as NodeRow) ?? t('nodes.deleteNodeTitle', { name: (selectedNode() as NodeRow).name })) : ''}
              toggleEnabledDisabled={setNodeEnabled.isPending || batchActionsBusy() || Boolean(deletingNodeId())}
              enabledValue={Boolean(
                selectedNode() &&
                  (Object.prototype.hasOwnProperty.call(nodeEnabledOverride(), (selectedNode() as NodeRow).id)
                    ? nodeEnabledOverride()[(selectedNode() as NodeRow).id]
                    : (selectedNode() as NodeRow).enabled),
              )}
              parseResourceMetric={parseResourceMetric}
              needsSelectHint={Boolean(selectedNode() && selectedNodeId() !== (selectedNode() as NodeRow).id)}
              showStaleSnapshot={showStaleSnapshot()}
              toggleEnabledLoading={setNodeEnabled.isPending}
            />
          }
        />

        <DeleteNodeModal
          t={t}
          openNodeId={confirmDeleteNodeId}
          setOpenNodeId={setConfirmDeleteNodeId}
          confirmText={confirmDeleteNodeText}
          setConfirmText={setConfirmDeleteNodeText}
          getNodeById={(id) => {
            const n = nodeList().find((x) => x.id === id)
            if (!n) return null
            return { id: n.id, name: n.name }
          }}
          deleting={Boolean(deletingNodeId())}
          onConfirmDelete={confirmDeleteNode}
        />

        <TriggerNodeUpdateModal
          t={t}
          mode={confirmUpdateMode() === 'batch' ? 'batch' : 'single'}
          open={confirmUpdateMode() != null}
          targets={
            confirmUpdateMode() === 'batch'
              ? selectedEnabledNodes().map((n) => ({ id: n.id, name: n.name }))
              : selectedNode()
                ? [{ id: (selectedNode() as NodeRow).id, name: (selectedNode() as NodeRow).name }]
                : []
          }
          pending={
            confirmUpdateMode() === 'batch'
              ? bulkUpdatePending()
              : Boolean(selectedNode() && updatingNodeIds()[(selectedNode() as NodeRow).id])
          }
          onClose={() => setConfirmUpdateMode(null)}
          onConfirm={async () => {
            if (confirmUpdateMode() === 'batch') {
              await confirmBatchNodeUpdates()
              return
            }
            const node = selectedNode() as NodeRow | null
            if (!node) return
            const result = await requestNodeUpdate(node, {
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
            setConfirmUpdateMode(null)
          }}
        />
      </>
    </Show>
  )
}
