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
    pushToast,
    invalidateInstances,
    toastError,
    instanceDeletePreview,
    setConfirmDeleteText,
  } = props as any

  return (
        <Modal
          open={confirmDeleteInstanceId() != null}
          onClose={() => setConfirmDeleteInstanceId(null)}
          title="Delete instance"
          description="This permanently deletes the instance directory under /data."
          size="sm"
          footer={
            <div class="flex gap-3">
              <Button variant="secondary" class="flex-1" onClick={() => setConfirmDeleteInstanceId(null)}>
                Cancel
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
                    pushToast('success', 'Deleted', id)
                    setConfirmDeleteInstanceId(null)
                    await invalidateInstances()
                  } catch (e) {
                    toastError('Delete failed', e)
                  }
                }}
              >
                Delete
              </Button>
            </div>
          }
        >
          <div class="space-y-4">
            <div class="rounded-2xl border border-slate-200 bg-white/60 p-4 text-[12px] text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
              <div class="flex items-center justify-between gap-3">
                <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Delete preview</div>
                <Show when={instanceDeletePreview.isPending}>
                  <span class="text-[11px] text-slate-400">loading…</span>
                </Show>
                <Show when={instanceDeletePreview.isError}>
                  <span class="text-[11px] text-rose-600 dark:text-rose-300">failed</span>
                </Show>
                <Show when={!instanceDeletePreview.isPending && !instanceDeletePreview.isError}>
                  <span class="text-[11px] text-slate-500 dark:text-slate-400">ok</span>
                </Show>
              </div>

              <Show when={instanceDeletePreview.data}>
                {(d) => (
                  <div class="mt-3 space-y-2">
                    <div class="flex items-center justify-between gap-3">
                      <div class="text-slate-500 dark:text-slate-400">Path</div>
                      <div class="min-w-0 truncate font-mono text-[11px]" title={d().path}>
                        {d().path}
                      </div>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                      <div class="text-slate-500 dark:text-slate-400">Estimated size</div>
                      <div class="font-mono text-[11px]">{formatBytes(Number(d().size_bytes))}</div>
                    </div>
                  </div>
                )}
              </Show>

              <Show when={instanceDeletePreview.isError}>
                <div class="mt-3 text-[11px] text-rose-700/80 dark:text-rose-200/70">
                  Preview unavailable. You can still delete after confirmation.
                </div>
              </Show>
            </div>

            <Field
              label="Type the instance id to confirm"
              required
              description="Tip: copy/paste the id to avoid typos."
              error={
                confirmDeleteText().trim().length > 0 && confirmDeleteText().trim() !== (confirmDeleteInstanceId() ?? '')
                  ? 'Does not match.'
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
