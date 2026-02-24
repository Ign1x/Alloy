import { For, Show } from 'solid-js'
import type { I18nTranslate } from '../../app/i18n'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'

export type TriggerNodeUpdateModalTarget = {
  id: string
  name: string
}

export type TriggerNodeUpdateModalMode = 'single' | 'batch'

export type TriggerNodeUpdateModalProps = {
  t: I18nTranslate
  mode: TriggerNodeUpdateModalMode
  open: boolean
  targets: TriggerNodeUpdateModalTarget[]
  pending: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
}

export default function TriggerNodeUpdateModal(props: TriggerNodeUpdateModalProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.t('nodes.updateModal.title')}
      description={props.mode === 'batch' ? props.t('nodes.updateModal.descBatch') : props.t('nodes.updateModal.descSingle')}
      size="sm"
      closeOnOverlayClick={!props.pending}
      closeOnEsc={!props.pending}
      footer={
        <div class="flex gap-3">
          <Button variant="secondary" class="flex-1" disabled={props.pending} onClick={props.onClose}>
            {props.t('nodes.updateModal.cancel')}
          </Button>
          <Button
            variant="primary"
            class="flex-1"
            loading={props.pending}
            disabled={props.pending || props.targets.length === 0}
            onClick={async () => {
              await props.onConfirm()
            }}
          >
            {props.t('nodes.updateModal.confirm')}
          </Button>
        </div>
      }
    >
      <div class="space-y-3">
        <div class="rounded-2xl border border-white/75 bg-gradient-to-br from-white/92 via-white/84 to-slate-100/72 p-4 text-[12px] text-slate-700 shadow-sm shadow-slate-900/5 dark:border-slate-700/65 dark:from-slate-950/82 dark:via-slate-950/72 dark:to-slate-900/64 dark:text-slate-200 dark:shadow-none">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {props.t('nodes.updateModal.previewTitle')}
          </div>
          <div class="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-300/75 bg-amber-100/84 px-2 py-1 text-[11px] font-semibold text-amber-900 dark:border-amber-800/55 dark:bg-amber-950/45 dark:text-amber-200">
            <span aria-hidden="true">!</span>
            <span>{props.mode === 'batch' ? props.t('nodes.updateModal.descBatch') : props.t('nodes.updateModal.descSingle')}</span>
          </div>

          <Show when={props.mode === 'single'} fallback={<div class="mt-2 text-[11px]">{props.t('nodes.updateModal.nodesCount', { count: props.targets.length })}</div>}>
            <Show when={props.targets[0]}>
              {(n) => (
                <div class="mt-2 flex items-center justify-between gap-3">
                  <div class="text-slate-500 dark:text-slate-400">{props.t('nodes.updateModal.node')}</div>
                  <div class="min-w-0 truncate font-mono text-[11px]" title={n().id}>
                    {n().name}
                  </div>
                </div>
              )}
            </Show>
          </Show>

          <Show when={props.mode === 'batch' && props.targets.length > 0}>
            <div class="mt-2 max-h-32 overflow-auto rounded-xl border border-slate-200/90 bg-white/80 p-2 font-mono text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-950/42 dark:text-slate-200">
              <For each={props.targets.slice(0, 8)}>{(n) => <div class="truncate">{n.name}</div>}</For>
              <Show when={props.targets.length > 8}>
                <div class="truncate text-slate-500 dark:text-slate-400">…</div>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </Modal>
  )
}
