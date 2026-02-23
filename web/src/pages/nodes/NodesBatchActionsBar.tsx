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
    <div class="motion-surface motion-enter rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40" role="region" aria-label={props.t('nodes.batchActions')}>
      <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span>{props.t('nodes.selectedSummary', { selected: props.selectedNodeCount, total: props.totalVisibleCount })}</span>
        <span>{props.t('nodes.outdatedSummary', { count: props.outdatedNodeCount })}</span>
      </div>

      <Show when={hasSelection()}>
        <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{props.t('nodes.selectedNames', { names: props.selectedNodesShortNames })}</div>
      </Show>

      <div class="mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center" role="toolbar" aria-label={props.t('nodes.batchQuickActions')}>
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

      <div class="mt-2 rounded-lg border border-rose-200/85 bg-rose-50/72 p-2 dark:border-rose-900/35 dark:bg-rose-950/18">
        <div class="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-700/85 dark:text-rose-200/75">{props.t('nodes.destructiveActions')}</div>
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
