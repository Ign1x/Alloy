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
  return (
    <div class="motion-surface motion-enter rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
      <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span>{props.t('nodes.selectedSummary', { selected: props.selectedNodeCount, total: props.totalVisibleCount })}</span>
        <span>{props.t('nodes.outdatedSummary', { count: props.outdatedNodeCount })}</span>
      </div>

      <Show when={props.selectedNodeCount > 0}>
        <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{props.t('nodes.selectedNames', { names: props.selectedNodesShortNames })}</div>
      </Show>

      <div class="mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
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
          disabled={props.busy || props.selectedNodeCount === 0}
          onClick={props.onClearBulkSelection}
        >
          {props.t('nodes.clear')}
        </Button>
        <Button
          size="xs"
          variant="primary"
          class="col-span-2 w-full sm:col-span-1 sm:w-auto"
          loading={props.bulkUpdatePending}
          disabled={props.busy || props.selectedNodeCount === 0}
          title={props.selectedNodeCount === 0 ? props.t('nodes.selectOneOrMoreFirst') : props.t('nodes.triggerSelectedUpdate')}
          onClick={async () => {
            await props.onRequestSelectedNodeUpdates()
          }}
        >
          {props.t('nodes.updateSelectedCount', { count: props.selectedNodeCount })}
        </Button>
      </div>
    </div>
  )
}
