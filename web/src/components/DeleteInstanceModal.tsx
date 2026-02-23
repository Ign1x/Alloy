import { Show } from 'solid-js'
import { formatBytes } from '../app/helpers/format'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
import { Input } from './ui/Input'
import { Modal } from './ui/Modal'

export type DeleteInstanceModalProps = {
  [key: string]: unknown
}

export default function DeleteInstanceModal(props: DeleteInstanceModalProps) {
  const {
    confirmDeleteInstanceId,
    setConfirmDeleteInstanceId,
    deleteInstance,
    confirmDeleteText,
    selectedInstanceId,
    setSelectedInstanceId,
    toastSuccessFromRspc,
    invalidateInstances,
    toastError,
    instanceDeletePreview,
    setConfirmDeleteText,
    t,
  } = props as any

  return (
        <Modal
          open={confirmDeleteInstanceId() != null}
          onClose={() => setConfirmDeleteInstanceId(null)}
          title={t('instances.deleteModal.title')}
          size="sm"
          description={t('instances.deleteModal.dangerHint')}
          footer={
            <div class="flex gap-3">
              <Button variant="secondary" class="flex-1" onClick={() => setConfirmDeleteInstanceId(null)}>
                {t('instances.common.cancel')}
              </Button>
              <Button
                variant="danger"
                class="flex-1"
                disabled={
                  deleteInstance.isPending ||
                  confirmDeleteText().trim() !== (confirmDeleteInstanceId() ?? '') ||
                  !confirmDeleteInstanceId()
                }
                loading={deleteInstance.isPending}
                onClick={async () => {
                  const id = confirmDeleteInstanceId()
                  if (!id) return
                  try {
                    await deleteInstance.mutateAsync({ instance_id: id })
                    if (selectedInstanceId() === id) setSelectedInstanceId(null)
                    toastSuccessFromRspc('instance.delete', t('instances.toast.deleted'), id)
                    setConfirmDeleteInstanceId(null)
                    await invalidateInstances()
                  } catch (e) {
                    toastError(t('instances.toast.deleteFailed'), e)
                  }
                }}
              >
                {t('instances.actions.delete')}
              </Button>
            </div>
          }
        >
          <div class="space-y-4">
              <div class="rounded-2xl border border-rose-200 bg-rose-50/75 p-4 text-[12px] text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                <div class="flex items-center justify-between gap-3">
                  <div class="text-xs font-semibold uppercase tracking-wider text-rose-700/85 dark:text-rose-200/80">{t('instances.deleteModal.previewTitle')}</div>
                  <Show when={instanceDeletePreview.isPending}>
                    <span class="text-[11px] text-slate-400">{t('instances.common.loading')}</span>
                  </Show>
                <Show when={instanceDeletePreview.isError}>
                  <span class="text-[11px] text-rose-600 dark:text-rose-300">{t('instances.common.failed')}</span>
                </Show>
                <Show when={!instanceDeletePreview.isPending && !instanceDeletePreview.isError}>
                  <span class="text-[11px] text-slate-500 dark:text-slate-400">{t('instances.common.ok')}</span>
                </Show>
              </div>

              <div class="mt-2 inline-flex items-center gap-1.5 rounded-md border border-rose-300/70 bg-rose-100/80 px-2 py-1 text-[11px] font-semibold text-rose-800 dark:border-rose-800/55 dark:bg-rose-950/45 dark:text-rose-200">
                <span aria-hidden="true">!</span>
                <span>{t('instances.deleteModal.dangerHint')}</span>
              </div>

              <Show when={instanceDeletePreview.data}>
                {(d) => (
                    <div class="mt-3 space-y-2">
                      <div class="flex items-center justify-between gap-3">
                        <div class="text-slate-500 dark:text-slate-400">{t('instances.deleteModal.path')}</div>
                        <div class="min-w-0 truncate font-mono text-[11px]" title={d().path}>
                          {d().path}
                        </div>
                      </div>
                      <div class="flex items-center justify-between gap-3">
                        <div class="text-slate-500 dark:text-slate-400">{t('instances.deleteModal.estimatedSize')}</div>
                        <div class="font-mono text-[11px]">{formatBytes(Number(d().size_bytes))}</div>
                      </div>
                    </div>
                  )}
              </Show>

              <Show when={instanceDeletePreview.isError}>
                <div class="mt-3 text-[11px] text-rose-700/80 dark:text-rose-200/70">
                  {t('instances.deleteModal.previewUnavailable')}
                </div>
              </Show>
            </div>

            <Field
              label={t('instances.deleteModal.typeToConfirm')}
              required
              error={
                confirmDeleteText().trim().length > 0 && confirmDeleteText().trim() !== (confirmDeleteInstanceId() ?? '')
                  ? t('instances.deleteModal.doesNotMatch')
                  : undefined
              }
            >
              <Input
                value={confirmDeleteText()}
                onInput={(e) => setConfirmDeleteText(e.currentTarget.value)}
                placeholder={confirmDeleteInstanceId() ?? ''}
                invalid={confirmDeleteText().trim().length > 0 && confirmDeleteText().trim() !== (confirmDeleteInstanceId() ?? '')}
              />
            </Field>
          </div>
        </Modal>
  )
}
