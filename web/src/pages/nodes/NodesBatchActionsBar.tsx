import { Show } from 'solid-js'
import type { I18nTranslate } from '../../app/i18n'
import { Button } from '../../components/ui/Button'

export type NodesBatchActionsBarProps = {
  t: I18nTranslate
  selectedNodeCount: number
  totalVisibleCount: number
  outdatedNodeCount: number
  selectedNodesShortNames: string
  busy: boolean
  bulkUpdatePending: boolean
  onSelectOutdatedNodes: () => void
  onSelectAllNodes: () => void
  onClearBulkSelection: () => void
  onRequestSelectedNodeUpdates: () => Promise<void> | void
}

export default function NodesBatchActionsBar(props: NodesBatchActionsBarProps) {
  const hasSelection = () => props.selectedNodeCount > 0

  return (
    <div
      class="motion-surface motion-enter rounded-2xl border border-white/70 bg-gradient-to-br from-white/92 via-white/82 to-slate-100/70 p-3.5 shadow-lg shadow-slate-900/5 dark:border-slate-700/65 dark:from-slate-950/82 dark:via-slate-950/70 dark:to-slate-900/66 dark:shadow-none"
      role="region"
      aria-label={props.t('nodes.batchActions')}
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="inline-flex items-center rounded-full border border-cyan-200/85 bg-cyan-50/88 px-2.5 py-0.5 text-[11px] font-medium text-cyan-900 dark:border-cyan-900/45 dark:bg-cyan-950/25 dark:text-cyan-200">
          {props.t('nodes.selectedSummary', { selected: props.selectedNodeCount, total: props.totalVisibleCount })}
        </span>
        <span class="inline-flex items-center rounded-full border border-amber-200/85 bg-amber-50/88 px-2.5 py-0.5 text-[11px] font-medium text-amber-900 dark:border-amber-900/45 dark:bg-amber-950/25 dark:text-amber-200">
          {props.t('nodes.outdatedSummary', { count: props.outdatedNodeCount })}
        </span>
      </div>

      <Show when={hasSelection()}>
        <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{props.t('nodes.selectedNames', { names: props.selectedNodesShortNames })}</div>
      </Show>

      <div class="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center" role="toolbar" aria-label={props.t('nodes.batchQuickActions')}>
        <Button
          size="xs"
          variant="secondary"
          class="w-full sm:w-auto"
          disabled={props.busy || props.outdatedNodeCount === 0}
          onClick={props.onSelectOutdatedNodes}
        >
          {props.t('nodes.selectOutdated')}
        </Button>
        <Button
          size="xs"
          variant="secondary"
          class="w-full sm:w-auto"
          disabled={props.busy || props.totalVisibleCount === 0}
          onClick={props.onSelectAllNodes}
        >
          {props.t('nodes.selectAll')}
        </Button>
        <Button
          size="xs"
          variant="secondary"
          class="w-full sm:w-auto"
          disabled={props.busy || !hasSelection()}
          onClick={props.onClearBulkSelection}
        >
          {props.t('nodes.clear')}
        </Button>
      </div>

      <div class="mt-3 rounded-xl border border-rose-200/85 bg-rose-50/78 p-2.5 dark:border-rose-900/35 dark:bg-rose-950/18">
        <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-700/85 dark:text-rose-200/75">
          {props.t('nodes.destructiveActions')}
        </div>
        <div role="toolbar" aria-label={props.t('nodes.batchDangerActions')}>
          <Button
            size="xs"
            variant="danger"
            class="w-full sm:w-auto"
            loading={props.bulkUpdatePending}
            disabled={props.busy || !hasSelection()}
            title={props.selectedNodeCount === 0 ? props.t('nodes.selectOneOrMoreFirst') : props.t('nodes.triggerSelectedUpdate')}
            onClick={async () => {
              await props.onRequestSelectedNodeUpdates()
            }}
          >
            {props.t('nodes.updateSelectedCount', { count: props.selectedNodeCount })}
          </Button>
        </div>
      </div>

      <Show when={!hasSelection()}>
        <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{props.t('nodes.selectNodesToUseBatchActions')}</div>
      </Show>
    </div>
  )
}
