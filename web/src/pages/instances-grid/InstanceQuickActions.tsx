import { Show, createEffect, createSignal } from 'solid-js'
import { canEditOrDeleteInstance, deleteInstanceActionTitle, editInstanceActionTitle } from '../../app/helpers/instanceActionReasons'
import { IconButton } from '../../components/ui/IconButton'

export type InstanceQuickActionsProps = {
  [key: string]: unknown
}

export default function InstanceQuickActions(props: InstanceQuickActionsProps) {
  const {
    i,
    isReadOnly,
    openEditModal,
    openFileInFiles,
    openInFiles,
    setConfirmDeleteInstanceId,
    t,
  } = props as any

  const [open, setOpen] = createSignal(false)
  let rootEl: HTMLDivElement | undefined

  const canEdit = () => canEditOrDeleteInstance(i.status, isReadOnly())
  const canDelete = () => canEditOrDeleteInstance(i.status, isReadOnly())

  const editDisabledReason = () => editInstanceActionTitle({ status: i.status, isReadOnly: isReadOnly(), t })

  const deleteDisabledReason = () => deleteInstanceActionTitle({ status: i.status, isReadOnly: isReadOnly(), t })

  createEffect(() => {
    if (!open()) return
    const onDoc = (ev: MouseEvent) => {
      const target = ev.target as Node | null
      if (!target) return
      if (rootEl?.contains(target)) return
      setOpen(false)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  })

  return (
    <div class="relative flex flex-col items-end gap-2" ref={(el) => (rootEl = el)}>
      <IconButton
        type="button"
        label={t('instances.actions.more')}
        title={t('instances.actions.more')}
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
          <path d="M10 4.25a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 4.25a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 4.25a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" />
        </svg>
      </IconButton>

      <Show when={open()}>
        <div class="z-20 w-44 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 p-1 shadow-2xl shadow-slate-900/10 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95" role="menu">
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-900/50"
            title={editDisabledReason()}
            disabled={!canEdit()}
            role="menuitem"
            onClick={() => {
              if (!canEdit()) return
              openEditModal(i)
              setOpen(false)
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-9.5 9.5a1 1 0 01-.39.242l-3.5 1.166a.5.5 0 01-.632-.632l1.166-3.5a1 1 0 01.242-.39l9.5-9.5z" />
            </svg>
            <span>{t('instances.actions.edit')}</span>
          </button>

          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900/50"
            title={t('instances.actions.openDirectory')}
            role="menuitem"
            onClick={() => {
              openInFiles(`instances/${i.config.instance_id}`)
              setOpen(false)
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
              <path d="M2 5.75A2.75 2.75 0 014.75 3h4.19a2.75 2.75 0 011.944.806l.56.56c.215.215.507.334.812.334h2.994A2.75 2.75 0 0118 7.45v6.8A2.75 2.75 0 0115.25 17H4.75A2.75 2.75 0 012 14.25v-8.5z" />
            </svg>
            <span>{t('instances.actions.files')}</span>
          </button>

          <Show when={i.config.template_id === 'minecraft:vanilla'}>
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900/50"
              title={t('instances.actions.openLatestLog')}
              role="menuitem"
              onClick={() => {
                openFileInFiles(`instances/${i.config.instance_id}/logs/latest.log`)
                setOpen(false)
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                <path
                  fill-rule="evenodd"
                  d="M3.25 4A2.75 2.75 0 016 1.25h5.586c.73 0 1.429.29 1.945.806l2.578 2.578c.516.516.805 1.214.805 1.944V16A2.75 2.75 0 0114.25 18.75H6A2.75 2.75 0 013.25 16V4zm8.5 1.25a.75.75 0 00-.75-.75H6A1.25 1.25 0 004.75 4v12c0 .69.56 1.25 1.25 1.25h8.25c.69 0 1.25-.56 1.25-1.25V7.5h-2.75a1 1 0 01-1-1V5.25z"
                  clip-rule="evenodd"
                />
              </svg>
              <span>{t('instances.actions.logs')}</span>
            </button>
          </Show>

          <button
            type="button"
            class="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-200 dark:hover:bg-rose-950/30"
            title={deleteDisabledReason()}
            disabled={!canDelete()}
            role="menuitem"
            onClick={() => {
              if (!canDelete()) return
              setConfirmDeleteInstanceId(i.config.instance_id)
              setOpen(false)
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
              <path
                fill-rule="evenodd"
                d="M8.75 2.75A.75.75 0 019.5 2h1a.75.75 0 01.75.75V3h3.5a.75.75 0 010 1.5h-.918l-.764 10.694A2.75 2.75 0 0111.327 18H8.673a2.75 2.75 0 01-2.741-2.806L5.168 4.5H4.25a.75.75 0 010-1.5h3.5v-.25zm1.5.25v.25h-1.5V3h1.5z"
                clip-rule="evenodd"
              />
            </svg>
            <span>{t('instances.actions.delete')}</span>
          </button>
        </div>
      </Show>
    </div>
  )
}
