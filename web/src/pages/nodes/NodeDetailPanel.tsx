import { Show } from 'solid-js'
import { formatBytes, formatCpuPercent, formatDateTimeFromIso, formatRelativeTimeFromIso, metricLevelByPercent, metricLevelClass } from '../../app/helpers/format'
import type { I18nTranslate } from '../../app/i18n'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { DataBoundary } from '../../components/ui/DataBoundary'
import { EmptyState } from '../../components/ui/EmptyState'
import { Spinner } from '../../components/ui/Spinner'
import type { NodeRow } from '../NodesTab'
import { nodeHealthBadgeVariant, nodeHealthLabelKey, nodeHealthStatus } from './nodeStatus'

export type NodeDetailPanelProps = {
  t: I18nTranslate
  meIsAdmin: boolean
  nodesIsPending: boolean
  nodesIsError: boolean
  nodesError: unknown
  onRetryNodes: () => void
  onOpenSettings: () => void
  nodeListLength: number
  selectedNode: NodeRow | null
  selectedNodeId: string | null
  updaterChecking: boolean
  updaterCheckFailed: boolean
  updaterConfigured: boolean
  updaterEndpoint: string
  updaterProvider: string
  updateCheckPending: boolean
  agentLatestTag: string | null
  agentUpdateAvailable: boolean | null
  onUpdateNode: () => Promise<void> | void
  onDeleteNode: () => Promise<void> | void
  onToggleEnabled: () => Promise<void> | void
  updateButtonVariant: 'primary' | 'secondary'
  updateButtonLoading: boolean
  updateButtonDisabled: boolean
  updateButtonTitle: string
  updateButtonLabel: string
  deleteButtonLoading: boolean
  deleteButtonDisabled: boolean
  deleteButtonTitle: string
  toggleEnabledDisabled: boolean
  enabledValue: boolean
  parseResourceMetric: (value: string | null | undefined) => number | null
  needsSelectHint: boolean
  showStaleSnapshot: boolean
  toggleEnabledLoading: boolean
}

export default function NodeDetailPanel(props: NodeDetailPanelProps) {
  const status = () => (props.selectedNode ? nodeHealthStatus(props.selectedNode) : 'unknown')
  const metricCardClass =
    'rounded-2xl border border-white/70 bg-gradient-to-br from-white/92 via-white/84 to-slate-100/74 p-3 shadow-sm shadow-slate-900/5 dark:border-slate-700/65 dark:from-slate-950/80 dark:via-slate-950/70 dark:to-slate-900/64 dark:shadow-none'

  return (
    <>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="text-section-title text-slate-700 dark:text-slate-300">{props.t('nodes.details')}</div>
      </div>

      <div class="mt-3 rounded-2xl border border-white/70 bg-gradient-to-br from-white/94 via-white/86 to-slate-100/72 p-3.5 shadow-xl shadow-slate-900/5 dark:border-slate-700/65 dark:from-slate-950/84 dark:via-slate-950/74 dark:to-slate-900/64 dark:shadow-none md:p-4">
        <DataBoundary
          t={props.t}
          loading={props.nodesIsPending}
          loadingLines={6}
          loadingHint={props.t('nodes.loadingNodes')}
          error={props.nodesError}
          errorTitle={props.t('nodes.failedLoad')}
          hasData={props.nodeListLength > 0}
          empty={!props.nodesIsPending && props.nodeListLength === 0}
          emptyTitle={props.t('nodes.noNodes')}
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
          <Show
            when={props.selectedNode}
            fallback={
              <div class="rounded-2xl border border-dashed border-slate-300/80 bg-white/62 p-8 dark:border-slate-700/75 dark:bg-slate-950/35">
                <EmptyState title={props.t('nodes.selectNode')} />
              </div>
            }
          >
            {(n) => (
              <div class="space-y-4">
                <div class="rounded-2xl border border-white/70 bg-gradient-to-r from-cyan-50/72 via-white/90 to-amber-50/70 p-3.5 shadow-sm shadow-slate-900/5 dark:border-slate-700/60 dark:from-cyan-950/22 dark:via-slate-950/72 dark:to-amber-950/20 dark:shadow-none">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 space-y-2">
                      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                        <div class="truncate text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">{n().name}</div>
                        <Badge variant={nodeHealthBadgeVariant(status())}>{props.t(nodeHealthLabelKey(status()))}</Badge>
                        <Show when={props.updaterChecking || props.updateButtonLoading || props.toggleEnabledLoading}>
                          <Badge variant="warning">{props.t('nodes.loading')}</Badge>
                        </Show>
                      </div>
                      <div class="truncate font-mono text-[11px] text-slate-600 dark:text-slate-400">{n().endpoint}</div>
                    </div>

                    <div class="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
                    <Show when={props.meIsAdmin}>
                      <Button
                        type="button"
                        size="sm"
                        variant={props.updateButtonVariant}
                        loading={props.updateButtonLoading}
                        disabled={props.updateButtonDisabled}
                        title={props.updateButtonTitle}
                        onClick={async () => {
                          await props.onUpdateNode()
                        }}
                      >
                        {props.updateButtonLabel}
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        loading={props.deleteButtonLoading}
                        disabled={props.deleteButtonDisabled}
                        title={props.deleteButtonTitle}
                        onClick={async () => {
                          await props.onDeleteNode()
                        }}
                        >
                          {props.t('nodes.deleteNode')}
                        </Button>

                        <button
                        type="button"
                        disabled={props.toggleEnabledDisabled}
                        aria-busy={props.toggleEnabledLoading ? 'true' : undefined}
                        title={props.enabledValue ? props.t('nodes.disableNode') : props.t('nodes.enableNode')}
                          class="group inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-200/90 bg-white/78 px-2.5 py-1.5 text-[11px] text-slate-700 shadow-sm hover:bg-white disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300 dark:shadow-none dark:hover:bg-slate-900 sm:w-auto"
                          onClick={async () => {
                            await props.onToggleEnabled()
                          }}
                      >
                        <span class="text-slate-500 dark:text-slate-500">{props.t('nodes.enabled')}</span>
                          <span
                            class={`relative inline-flex h-5 w-9 items-center rounded-full border transition-colors ${
                              props.enabledValue
                                ? 'border-emerald-300/85 bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/28'
                                : 'border-slate-300 bg-slate-200 dark:border-slate-700 dark:bg-slate-900/40'
                            }`}
                          >
                          <span
                            class={`inline-block h-4 w-4 transform rounded-full bg-slate-100 shadow transition-transform ${
                              props.enabledValue ? 'translate-x-4' : 'translate-x-1'
                            }`}
                          />
                        </span>
                        <Show when={props.toggleEnabledLoading}>
                          <Spinner class="h-3.5 w-3.5" title={props.t('nodes.updating')} />
                        </Show>
                      </button>
                    </Show>
                  </div>
                </div>

                  <Show when={props.meIsAdmin && props.selectedNodeId === n().id}>
                    <div class="mt-2 flex flex-wrap items-center gap-1.5">
                      <Show when={props.updaterChecking}>
                        <span class="inline-flex items-center rounded-full border border-slate-200/90 bg-white/86 px-2 py-0.5 text-[10px] text-slate-700 dark:border-slate-700 dark:bg-slate-950/55 dark:text-slate-300">
                          {props.t('nodes.checkingUpdater')}
                        </span>
                      </Show>

                      <Show when={!props.updaterChecking && !props.updaterCheckFailed}>
                        <span
                          class={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${
                            props.updaterConfigured
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300'
                              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300'
                          }`}
                          title={props.updaterEndpoint}
                        >
                          {props.updaterConfigured ? props.t('nodes.updaterConfigured') : props.t('nodes.updaterNotConfigured')}
                        </span>
                      </Show>

                      <Show when={props.updateCheckPending}>
                        <span class="inline-flex items-center rounded-full border border-slate-200/90 bg-white/86 px-2 py-0.5 text-[10px] text-slate-700 dark:border-slate-700 dark:bg-slate-950/55 dark:text-slate-300">
                          {props.t('nodes.checkingTargetVersion')}
                        </span>
                      </Show>

                      <Show when={!props.updateCheckPending && props.agentLatestTag}>
                        <span class="inline-flex items-center rounded-full border border-slate-200/90 bg-white/86 px-2 py-0.5 text-[10px] text-slate-700 dark:border-slate-700 dark:bg-slate-950/55 dark:text-slate-300">
                          {props.t('nodes.targetTag', { tag: props.agentLatestTag ?? '-' })}
                        </span>
                        <Show when={props.agentUpdateAvailable === true}>
                          <span class="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
                            {props.t('nodes.updateAvailable')}
                          </span>
                        </Show>
                        <Show when={props.agentUpdateAvailable === false}>
                          <span class="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">
                            {props.t('nodes.agentUpToDate')}
                          </span>
                        </Show>
                        <Show when={props.agentUpdateAvailable == null}>
                          <span class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
                            {props.t('nodes.versionCompareUnavailable')}
                          </span>
                        </Show>
                      </Show>

                      <Show when={!props.updaterChecking && props.updaterCheckFailed}>
                        <span class="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
                          {props.t('nodes.updaterCheckFailed')}
                        </span>
                      </Show>

                      <Show when={!props.updaterChecking && !props.updaterCheckFailed}>
                        <span class="truncate font-mono text-[10px] text-slate-500 dark:text-slate-400" title={props.updaterEndpoint}>
                          {props.updaterProvider.toLowerCase()} · {props.updaterEndpoint || '-'}
                        </span>
                      </Show>
                    </div>
                  </Show>
                </div>

                <Show when={props.needsSelectHint}>
                  <div class="rounded-xl border border-amber-200/90 bg-amber-50/88 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/24 dark:text-amber-300">
                    {props.t('nodes.selectNodeHint')}
                  </div>
                </Show>

                <div class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                  <div class={metricCardClass}>
                    <div class="text-[11px] text-slate-500">{props.t('nodes.status')}</div>
                    <div class="mt-1">
                      <Badge variant={nodeHealthBadgeVariant(status())}>{props.t(nodeHealthLabelKey(status()))}</Badge>
                    </div>
                  </div>

                  <div class={metricCardClass}>
                    <div class="text-[11px] text-slate-500">{props.t('nodes.cpu')}</div>
                    <div class={`mt-1 font-semibold ${metricLevelClass(metricLevelByPercent((n().cpu_percent_x100 ?? 0) / 100))}`}>
                      {formatCpuPercent(n().cpu_percent_x100 ?? null)}
                    </div>
                  </div>

                  <div class={metricCardClass}>
                    <div class="text-[11px] text-slate-500">{props.t('nodes.agentCurrent')}</div>
                    <div class="mt-1 text-slate-700 dark:text-slate-200">{n().agent_version ?? '-'}</div>
                  </div>

                  <div class={metricCardClass}>
                    <div class="text-[11px] text-slate-500">{props.t('nodes.memory')}</div>
                    <div class="mt-1 text-slate-700 dark:text-slate-200">
                      {formatBytes(props.parseResourceMetric(n().memory_used_bytes))}
                      {' / '}
                      {formatBytes(props.parseResourceMetric(n().memory_total_bytes))}
                    </div>
                  </div>

                  <div class={metricCardClass}>
                    <div class="text-[11px] text-slate-500">{props.t('nodes.agentTarget')}</div>
                    <div class="mt-1 text-slate-700 dark:text-slate-200">{props.agentLatestTag ?? '-'}</div>
                  </div>

                  <div class={metricCardClass}>
                    <div class="text-[11px] text-slate-500">{props.t('nodes.networkIo')}</div>
                    <div class="mt-1 text-slate-700 dark:text-slate-200">
                      {formatBytes(props.parseResourceMetric(n().network_rx_bytes_per_sec))}↓/s {' · '}
                      {formatBytes(props.parseResourceMetric(n().network_tx_bytes_per_sec))}↑/s
                    </div>
                  </div>

                  <div class={metricCardClass}>
                    <div class="text-[11px] text-slate-500">{props.t('nodes.agentUpdate')}</div>
                    <div class="mt-1 text-slate-700 dark:text-slate-200">
                      {props.agentUpdateAvailable === true
                        ? props.t('nodes.available')
                        : props.agentUpdateAvailable === false
                          ? props.t('nodes.upToDate')
                          : props.t('nodes.unknown')}
                    </div>
                  </div>

                  <div class={metricCardClass}>
                    <div class="text-[11px] text-slate-500">{props.t('nodes.diskIo')}</div>
                    <div class="mt-1 text-slate-700 dark:text-slate-200">
                      {formatBytes(props.parseResourceMetric(n().disk_read_bytes_per_sec))}↓/s {' · '}
                      {formatBytes(props.parseResourceMetric(n().disk_write_bytes_per_sec))}↑/s
                    </div>
                  </div>

                  <div class="sm:col-span-2">
                    <div class={metricCardClass}>
                      <div class="text-[11px] text-slate-500">{props.t('nodes.lastSeen')}</div>
                      <div class="mt-1 flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-200">
                        <span class="font-mono text-[11px]">{formatDateTimeFromIso(n().last_seen_at)}</span>
                        <span class="text-[11px] text-slate-500 dark:text-slate-400">
                          {props.t('nodes.lastSeenRelative', { value: formatRelativeTimeFromIso(n().last_seen_at) })}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div class="sm:col-span-2">
                    <div class="rounded-2xl border border-rose-200/80 bg-rose-50/75 p-3 shadow-sm shadow-rose-900/5 dark:border-rose-900/40 dark:bg-rose-950/18 dark:shadow-none">
                      <div class="text-[11px] text-rose-600 dark:text-rose-300">{props.t('nodes.lastError')}</div>
                      <div class="mt-1 font-mono text-[11px] text-rose-700 dark:text-rose-300">{n().last_error ?? '-'}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Show>
        </DataBoundary>
      </div>
    </>
  )
}
