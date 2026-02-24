import { For, Show } from 'solid-js'
import {
  formatCpuPercent,
  formatDateTimeFromIso,
  formatRelativeTime,
  formatRelativeTimeFromIso,
  metricLevelByPercent,
  metricLevelClass,
} from '../../app/helpers/format'
import type { I18nTranslate } from '../../app/i18n'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { DataBoundary } from '../../components/ui/DataBoundary'
import { IconButton } from '../../components/ui/IconButton'
import { Input } from '../../components/ui/Input'
import type { NodeRow } from '../NodesTab'
import NodesBatchActionsBar from './NodesBatchActionsBar'
import { nodeHealthBadgeVariant, nodeHealthLabelKey, nodeHealthStatus } from './nodeStatus'

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
  isNodeUpdating: (nodeId: string) => boolean
  showStaleSnapshot: boolean
}

export default function NodesFleetPanel(props: NodesFleetPanelProps) {
  const visibleNodeCount = () => props.filteredNodeList.length
  const selectedRatio = () => `${props.selectedNodeCount}/${visibleNodeCount()}`
  const rowButtonRefs: Record<string, HTMLButtonElement | undefined> = {}

  return (
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-section-title text-slate-700 dark:text-slate-300">{props.t('nodes.fleet')}</div>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span class="inline-flex items-center rounded-full border border-slate-200/85 bg-white/86 px-2.5 py-0.5 text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-950/52 dark:text-slate-300 dark:shadow-none">
              {props.t('nodes.totalCount', { count: props.nodeList.length })}
            </span>
            <Show when={props.meIsAdmin && visibleNodeCount() > 0}>
              <span class="inline-flex items-center rounded-full border border-cyan-200/80 bg-cyan-50/88 px-2.5 py-0.5 font-semibold text-cyan-900 shadow-sm dark:border-cyan-900/45 dark:bg-cyan-950/25 dark:text-cyan-200 dark:shadow-none">
                {props.t('nodes.selectedSummaryCompact', { ratio: selectedRatio() })}
              </span>
            </Show>
          </div>
          <div class="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">{props.t('nodes.shortcutHint')}</div>
        </div>
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

      <div class="motion-surface motion-enter rounded-2xl border border-white/70 bg-gradient-to-br from-white/92 via-white/82 to-slate-100/70 p-3.5 shadow-lg shadow-slate-900/5 dark:border-slate-700/65 dark:from-slate-950/82 dark:via-slate-950/70 dark:to-slate-900/66 dark:shadow-none">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{props.t('nodes.overview')}</div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400">{props.t('nodes.totalCount', { count: props.nodeList.length })}</div>
        </div>
        <div class="mt-3 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
          <div class="rounded-xl border border-emerald-200/90 bg-emerald-50/90 px-2.5 py-2 text-emerald-900 shadow-sm dark:border-emerald-900/45 dark:bg-emerald-950/20 dark:text-emerald-300 dark:shadow-none">
            {props.t('nodes.healthyCount', { count: props.healthyNodeCount })}
          </div>
          <div class="rounded-xl border border-rose-200/90 bg-rose-50/90 px-2.5 py-2 text-rose-900 shadow-sm dark:border-rose-900/45 dark:bg-rose-950/20 dark:text-rose-300 dark:shadow-none">
            {props.t('nodes.errorCount', { count: props.errorNodeCount })}
          </div>
          <div class="rounded-xl border border-slate-200/90 bg-slate-50/90 px-2.5 py-2 text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300 dark:shadow-none">
            {props.t('nodes.unknownCount', { count: props.unknownNodeCount })}
          </div>
        </div>
      </div>

      <div class="motion-surface motion-enter rounded-2xl border border-white/70 bg-gradient-to-br from-white/92 via-white/82 to-slate-100/70 p-3.5 shadow-lg shadow-slate-900/5 dark:border-slate-700/65 dark:from-slate-950/82 dark:via-slate-950/70 dark:to-slate-900/66 dark:shadow-none">
        <label class="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400" for="nodes-search-input">
          {props.t('nodes.searchLabel')}
        </label>
        <div class="mt-2 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <Input
            id="nodes-search-input"
            ref={props.setNodeSearchInputEl}
            value={props.nodeSearchInput}
            placeholder={props.t('nodes.searchPlaceholder')}
            aria-label={props.t('nodes.searchAria')}
            spellcheck={false}
            onInput={(event) => props.setNodeSearchInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                const first = props.filteredNodeList[0]
                if (!first) return
                props.onSelectNode(first.id)
                return
              }
              if (event.key !== 'Enter') return
              const first = props.filteredNodeList[0]
              if (!first) return
              props.onSelectNode(first.id)
            }}
            leftIcon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" class="h-4 w-4" aria-hidden="true">
                <path d="M12.75 12.75L16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                <circle cx="8.75" cy="8.75" r="5" stroke="currentColor" stroke-width="1.5" />
              </svg>
            }
            rightIcon={
              props.nodeSearchInput.trim().length > 0 ? (
                <button
                  type="button"
                  class="ring-focus -m-1 rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none dark:text-slate-400 dark:hover:bg-slate-900/60 dark:hover:text-slate-100"
                  aria-label={props.t('nodes.clearSearch')}
                  title={props.t('nodes.clearSearch')}
                  onClick={() => props.setNodeSearchInput('')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                    <path
                      fill-rule="evenodd"
                      d="M4.47 4.47a.75.75 0 011.06 0L10 8.94l4.47-4.47a.75.75 0 111.06 1.06L11.06 10l4.47 4.47a.75.75 0 11-1.06 1.06L10 11.06l-4.47 4.47a.75.75 0 11-1.06-1.06L8.94 10 4.47 5.53a.75.75 0 010-1.06z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </button>
              ) : undefined
            }
          />
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
            <Show when={props.meIsAdmin && props.nodeList.length === 0 && props.nodeSearch.length === 0}>
              <Button size="xs" variant="primary" onClick={props.onOpenCreateNode}>
                {props.t('nodes.addNode')}
              </Button>
            </Show>
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
        stale={{
          show: props.showStaleSnapshot,
          title: props.t('nodes.refreshFailedTitle'),
          message: props.t('nodes.refreshFailedMessage'),
          onRetry: props.onRetryNodes,
        }}
      >
        <Show when={props.filteredNodeList.length > 0}>
          <div
            class="motion-surface motion-enter max-h-[40vh] overflow-auto rounded-2xl border border-white/65 bg-white/72 p-1.5 shadow-lg shadow-slate-900/5 dark:border-slate-700/65 dark:bg-slate-950/52 dark:shadow-none md:max-h-96"
            role="region"
            aria-label={props.t('nodes.nodeListAria')}
          >
            <For each={props.filteredNodeList}>
              {(node) => (
                <div class="group flex items-center gap-1 border-b border-slate-200/75 px-1 py-1 last:border-b-0 dark:border-slate-800/75">
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
                    aria-current={props.selectedNodeId === node.id ? 'true' : undefined}
                    class={`motion-pop ring-focus min-w-0 flex-1 rounded-xl border px-2.5 py-2 text-left transition-colors hover:bg-white focus-visible:outline-none dark:hover:bg-slate-900 ${
                      props.selectedNodeId === node.id
                        ? 'border-cyan-300/75 bg-gradient-to-r from-cyan-50/75 via-sky-50/55 to-white/65 shadow-sm dark:border-cyan-800/55 dark:from-cyan-950/32 dark:via-slate-950/60 dark:to-slate-950/45'
                        : 'border-transparent bg-transparent'
                    }`}
                    title={props.t('nodes.selectNode')}
                    ref={(el) => {
                      rowButtonRefs[node.id] = el
                    }}
                    onKeyDown={(event) => {
                      const key = event.key.toLowerCase()
                      if (props.meIsAdmin && (event.metaKey || event.ctrlKey) && key === 'a') {
                        event.preventDefault()
                        props.onSelectAllNodes()
                        return
                      }

                      const rows = props.filteredNodeList
                      if (!rows.length) return
                      const currentIndex = rows.findIndex((item) => item.id === node.id)
                      if (currentIndex < 0) return
                      let nextIndex = currentIndex
                      if (event.key === 'ArrowDown') nextIndex = Math.min(currentIndex + 1, rows.length - 1)
                      else if (event.key === 'ArrowUp') nextIndex = Math.max(currentIndex - 1, 0)
                      else if (event.key === 'Home') nextIndex = 0
                      else if (event.key === 'End') nextIndex = rows.length - 1
                      else return
                      event.preventDefault()
                      const next = rows[nextIndex]
                      if (!next) return
                      props.onSelectNode(next.id)
                      queueMicrotask(() => rowButtonRefs[next.id]?.focus())
                    }}
                    onClick={() => props.onSelectNode(node.id)}
                    >
                      <div class="flex items-center justify-between gap-2">
                        <div class="min-w-0">
                          <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                            <div class="truncate text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">{node.name}</div>
                            <Badge variant={nodeHealthBadgeVariant(nodeHealthStatus(node))}>
                              {props.t(nodeHealthLabelKey(nodeHealthStatus(node)))}
                            </Badge>
                          <Show when={props.isNodeSelected(node.id)}>
                            <Badge variant="warning">{props.t('nodes.selectedShort')}</Badge>
                          </Show>
                        </div>
                        <div class="mt-0.5 truncate font-mono text-[11px] text-slate-500">{node.endpoint}</div>
                        <div class="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                          <span class="inline-flex items-center rounded-full border border-slate-200/90 bg-white/70 px-1.5 py-0.5 dark:border-slate-800 dark:bg-slate-950/40">
                            {props.t('nodes.lastSeenRelative', { value: formatRelativeTimeFromIso(node.last_seen_at) })}
                          </span>
                          <Show when={node.last_seen_at}>
                            <span class="truncate" title={formatDateTimeFromIso(node.last_seen_at)}>
                              {formatDateTimeFromIso(node.last_seen_at)}
                            </span>
                          </Show>
                        </div>
                      </div>
                      <div class="flex items-center gap-1.5">
                        <Show when={node.cpu_percent_x100 != null}>
                          <span class={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${metricLevelClass(metricLevelByPercent((node.cpu_percent_x100 ?? 0) / 100))}`}>
                            {formatCpuPercent(node.cpu_percent_x100)}
                          </span>
                        </Show>
                        <Show when={props.isNodeUpdating(node.id)}>
                          <span class="inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-300">
                            <span class="h-3.5 w-3.5 animate-spin rounded-full border border-amber-500/50 border-t-transparent" />
                            {props.t('nodes.updatingShort')}
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

      <div class="sr-only" aria-live="polite">
        {props.t('nodes.shortcutHint')}
      </div>
    </div>
  )
}
