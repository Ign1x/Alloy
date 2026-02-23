import { createEffect, Show } from 'solid-js'
import type { I18nTranslate } from '../../app/i18n'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'

export type DeleteNodeModalNode = {
  id: string
  name: string
}

export type DeleteNodeModalProps = {
  t: I18nTranslate
  openNodeId: () => string | null
  setOpenNodeId: (value: string | null) => void
  confirmText: () => string
  setConfirmText: (value: string) => void
  getNodeById: (id: string) => DeleteNodeModalNode | null
  deleting: boolean
  onConfirmDelete: (nodeId: string) => Promise<void>
}

export default function DeleteNodeModal(props: DeleteNodeModalProps) {
  let inputEl: HTMLInputElement | undefined

  createEffect(() => {
    const id = props.openNodeId()
    if (!id) {
      props.setConfirmText('')
      return
    }
    props.setConfirmText('')
  })

  const node = () => {
    const id = props.openNodeId()
    if (!id) return null
    return props.getNodeById(id)
  }

  const requiredText = () => node()?.name ?? ''
  const matches = () => props.confirmText().trim() === requiredText()

  return (
    <Modal
      open={props.openNodeId() != null}
      onClose={() => props.setOpenNodeId(null)}
      title={props.t('nodes.deleteModal.title')}
      description={props.t('nodes.deleteModal.desc')}
      size="sm"
      closeOnOverlayClick={!props.deleting}
      closeOnEsc={!props.deleting}
      initialFocus={() => inputEl}
      footer={
        <div class="flex gap-3">
          <Button variant="secondary" class="flex-1" onClick={() => props.setOpenNodeId(null)}>
            {props.t('nodes.deleteModal.cancel')}
          </Button>
          <Button
            variant="danger"
            class="flex-1"
            disabled={props.deleting || !matches() || !props.openNodeId()}
            loading={props.deleting}
            onClick={async () => {
              const id = props.openNodeId()
              if (!id) return
              await props.onConfirmDelete(id)
            }}
          >
            {props.t('nodes.deleteModal.confirm')}
          </Button>
        </div>
      }
    >
      <Show when={node()}>
        {(n) => (
          <div class="space-y-4">
            <div class="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-[12px] text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
              <div class="text-xs font-semibold uppercase tracking-wider text-rose-700/80 dark:text-rose-200/70">
                {props.t('nodes.deleteModal.previewTitle')}
              </div>
              <div class="mt-2 inline-flex items-center gap-1.5 rounded-md border border-rose-300/70 bg-rose-100/80 px-2 py-1 text-[11px] font-semibold text-rose-800 dark:border-rose-800/55 dark:bg-rose-950/45 dark:text-rose-200">
                <span aria-hidden="true">!</span>
                <span>{props.t('nodes.deleteModal.desc')}</span>
              </div>
              <div class="mt-2 flex items-center justify-between gap-3">
                <div class="text-rose-700/80 dark:text-rose-200/70">{props.t('nodes.deleteModal.node')}</div>
                <div class="min-w-0 truncate font-mono text-[11px]" title={n().id}>
                  {n().id}
                </div>
              </div>
              <div class="mt-1 flex items-center justify-between gap-3">
                <div class="text-rose-700/80 dark:text-rose-200/70">{props.t('nodes.deleteModal.name')}</div>
                <div class="min-w-0 truncate font-mono text-[11px]" title={n().name}>
                  {n().name}
                </div>
              </div>
            </div>

            <Field
              label={props.t('nodes.deleteModal.typeToConfirm', { value: requiredText() })}
              required
              error={
                props.confirmText().trim().length > 0 && !matches() ? props.t('nodes.deleteModal.doesNotMatch') : undefined
              }
            >
              <Input
                ref={(el) => (inputEl = el)}
                value={props.confirmText()}
                onInput={(e) => props.setConfirmText(e.currentTarget.value)}
                placeholder={requiredText()}
                invalid={props.confirmText().trim().length > 0 && !matches()}
              />
            </Field>
          </div>
        )}
      </Show>
    </Modal>
  )
}
