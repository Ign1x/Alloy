import { For, Show } from 'solid-js'
import { formatCpuPercent, formatRelativeTime, metricLevelByPercent, metricLevelClass } from '../../app/helpers/format'
import type { I18nTranslate } from '../../app/i18n'
import { Button } from '../../components/ui/Button'
import { DataBoundary } from '../../components/ui/DataBoundary'
import { IconButton } from '../../components/ui/IconButton'
import type { NodeRow } from '../NodesTab'
import NodesBatchActionsBar from './NodesBatchActionsBar'

export type NodesFleetPanelProps = {
  t: I18nTranslate
  meIsAdmin: boolean
  onOpenCreateNode: () => void
  nodeList: NodeRow[]
  healthyNodeCount: number
  errorNodeCount: number
  unknownNodeCount: number
  nodesLastUpdatedAtUnixMs: number | null
  nodesIsPending: boolean
  nodesIsError: boolean
  nodesError: unknown
  onRetryNodes: () => void
  onOpenSettings: () => void
  filteredNodeList: NodeRow[]
  nodeSearch: string
  nodeSearchInput: string
  setNodeSearchInput: (value: string) => void
  setNodeSearchInputEl: (el: HTMLInputElement) => void
  onSelectNode: (nodeId: string) => void
  selectedNodeId: string | null
  selectedNodeCount: number
  outdatedNodeCount: number
  selectedNodesShortNames: string
  batchActionsBusy: boolean
  onSelectOutdatedNodes: () => void
  onSelectAllNodes: () => void
  onClearBulkSelection: () => void
  onTriggerSelectedNodeUpdates: () => Promise<void> | void
  bulkUpdatePending: boolean
  isNodeSelected: (nodeId: string) => boolean
  setNodeSelected: (nodeId: string, selected: boolean) => void
}

export default function NodesFleetPanel(props: NodesFleetPanelProps) {
  return (
    <div class="space-y-3">
      <div class="flex items-center justify-end gap-2">
        <Show when={props.meIsAdmin}>
          <IconButton type="button" label={props.t('nodes.addNode')} variant="secondary" onClick={props.onOpenCreateNode}>
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

      <div class="motion-surface motion-enter rounded-xl border border-slate-200 bg-white/70 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{props.t('nodes.overview')}</div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400">{props.t('nodes.totalCount', { count: props.nodeList.length })}</div>
        </div>
        <div class="mt-2 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
          <div class="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">
            {props.t('nodes.healthyCount', { count: props.healthyNodeCount })}
          </div>
          <div class="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            {props.t('nodes.errorCount', { count: props.errorNodeCount })}
          </div>
          <div class="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
            {props.t('nodes.unknownCount', { count: props.unknownNodeCount })}
          </div>
        </div>
      </div>

      <div class="motion-surface motion-enter rounded-xl border border-slate-200 bg-white/70 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
        <label class="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400" for="nodes-search-input">
          {props.t('nodes.searchLabel')}
        </label>
        <div class="mt-2 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <input
            id="nodes-search-input"
            ref={props.setNodeSearchInputEl}
            class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            type="text"
            value={props.nodeSearchInput}
            placeholder={props.t('nodes.searchPlaceholder')}
            onInput={(event) => props.setNodeSearchInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              const first = props.filteredNodeList[0]
              if (!first) return
              props.onSelectNode(first.id)
            }}
          />
          <Show when={props.nodeSearchInput.trim().length > 0}>
            <Button size="xs" variant="secondary" class="w-full sm:w-auto" onClick={() => props.setNodeSearchInput('')}>
              {props.t('nodes.clear')}
            </Button>
          </Show>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span>{props.t('nodes.updatedRelative', { value: formatRelativeTime(props.nodesLastUpdatedAtUnixMs) })}</span>
        <Show when={props.nodesIsPending}>
          <span class="inline-flex items-center gap-1">
            <span class="h-1.5 w-1.5 rounded-full bg-slate-500 animate-pulse" />
            {props.t('nodes.loading')}
          </span>
        </Show>
        <Show when={props.nodesIsError}>
          <span class="inline-flex items-center gap-1">
            <span class="h-1.5 w-1.5 rounded-full bg-rose-500" />
            {props.t('nodes.error')}
          </span>
        </Show>
      </div>

      <Show when={props.meIsAdmin && !props.nodesIsError && !props.nodesIsPending && props.filteredNodeList.length > 0}>
        <NodesBatchActionsBar
          t={props.t}
          selectedNodeCount={props.selectedNodeCount}
          totalVisibleCount={props.filteredNodeList.length}
          outdatedNodeCount={props.outdatedNodeCount}
          selectedNodesShortNames={props.selectedNodesShortNames}
          busy={props.batchActionsBusy}
          bulkUpdatePending={props.bulkUpdatePending}
          onSelectOutdatedNodes={props.onSelectOutdatedNodes}
          onSelectAllNodes={props.onSelectAllNodes}
          onClearBulkSelection={props.onClearBulkSelection}
          onRequestSelectedNodeUpdates={props.onTriggerSelectedNodeUpdates}
        />
      </Show>

      <DataBoundary
        t={props.t}
        loading={props.nodesIsPending}
        loadingLines={6}
        loadingHint={props.t('nodes.loadingNodes')}
        error={props.nodesError}
        errorTitle={props.t('nodes.failedLoad')}
        hasData={props.nodeList.length > 0}
        empty={!props.nodesIsPending && props.filteredNodeList.length === 0}
        emptyTitle={props.nodeSearch.length > 0 ? props.t('nodes.noMatchingNodes') : props.t('nodes.noNodes')}
        emptyActions={
          <div class="flex flex-wrap items-center gap-2">
            <Show when={props.nodeSearch.length > 0}>
              <Button size="xs" variant="secondary" onClick={() => props.setNodeSearchInput('')}>
                {props.t('nodes.clearSearch')}
              </Button>
            </Show>
            <Button size="xs" variant="secondary" onClick={props.onRetryNodes}>
              {props.t('nodes.retry')}
            </Button>
          </div>
        }
        onRetry={props.onRetryNodes}
        onOpenSettings={props.onOpenSettings}
        settingsCtaLabel={props.t('tab.settings')}
      >
        <Show when={props.filteredNodeList.length > 0}>
          <div class="motion-surface motion-enter max-h-[40vh] overflow-auto rounded-xl border border-slate-200 bg-white/60 p-1 dark:border-slate-800 dark:bg-slate-950/40 md:max-h-96">
            <For each={props.filteredNodeList}>
              {(node) => (
                <div class="flex items-center gap-1 rounded-lg px-1 py-1">
                  <Show when={props.meIsAdmin}>
                    <input
                      type="checkbox"
                      class="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500/35 dark:border-slate-700 dark:bg-slate-900"
                      checked={props.isNodeSelected(node.id)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => props.setNodeSelected(node.id, event.currentTarget.checked)}
                      title={props.t('nodes.selectForBatchUpdate')}
                    />
                  </Show>

                  <button
                    type="button"
                    class={`motion-pop min-w-0 flex-1 rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-900 ${
                      props.selectedNodeId === node.id ? 'bg-slate-100 dark:bg-slate-900' : ''
                    }`}
                    onClick={() => props.onSelectNode(node.id)}
                  >
                    <div class="flex items-center justify-between gap-2">
                      <div class="min-w-0">
                        <div class="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{node.name}</div>
                        <div class="mt-0.5 truncate font-mono text-[11px] text-slate-500">{node.endpoint}</div>
                      </div>
                      <div class="flex items-center gap-1.5">
                        <span
                          class={`h-2 w-2 rounded-full ${
                            node.last_error ? 'bg-rose-500' : node.last_seen_at ? 'bg-emerald-400' : 'bg-slate-500'
                          }`}
                        />
                        <Show when={node.cpu_percent_x100 != null}>
                          <span class={`text-[10px] font-semibold ${metricLevelClass(metricLevelByPercent((node.cpu_percent_x100 ?? 0) / 100))}`}>
                            {formatCpuPercent(node.cpu_percent_x100)}
                          </span>
                        </Show>
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </DataBoundary>
    </div>
  )
}
