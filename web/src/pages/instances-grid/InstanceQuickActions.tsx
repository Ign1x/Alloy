import { Show } from 'solid-js'
import { canStartInstance } from '../../app/helpers/instances'
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
  } = props as any

  return (
    <div class="flex items-center gap-2">
      <div class="flex items-center gap-1.5 max-w-0 overflow-hidden opacity-0 transition-[max-width,opacity] duration-150 invisible group-hover:visible group-hover:max-w-[480px] group-hover:opacity-100 group-hover:overflow-visible group-focus-within:visible group-focus-within:max-w-[480px] group-focus-within:opacity-100 group-focus-within:overflow-visible">
        <IconButton
          type="button"
          label="Edit"
          title={
            isReadOnly()
              ? 'Read-only mode'
              : !canStartInstance(i.status)
                ? 'Stop the instance before editing'
                : 'Edit instance parameters'
          }
          variant="ghost"
          disabled={isReadOnly() || !canStartInstance(i.status)}
          onClick={() => openEditModal(i)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
            <path d="M13.586 3.586a2 2 0 112.828 2.828l-9.5 9.5a1 1 0 01-.39.242l-3.5 1.166a.5.5 0 01-.632-.632l1.166-3.5a1 1 0 01.242-.39l9.5-9.5z" />
          </svg>
        </IconButton>

        <IconButton
          type="button"
          label="Files"
          title="Open instance directory"
          variant="ghost"
          onClick={() => openInFiles(`instances/${i.config.instance_id}`)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
            <path d="M2 5.75A2.75 2.75 0 014.75 3h4.19a2.75 2.75 0 011.944.806l.56.56c.215.215.507.334.812.334h2.994A2.75 2.75 0 0118 7.45v6.8A2.75 2.75 0 0115.25 17H4.75A2.75 2.75 0 012 14.25v-8.5z" />
          </svg>
        </IconButton>

        <Show when={i.config.template_id === 'minecraft:vanilla'}>
          <IconButton
            type="button"
            label="Log"
            title="Open latest.log"
            variant="ghost"
            onClick={() => openFileInFiles(`instances/${i.config.instance_id}/logs/latest.log`)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
              <path
                fill-rule="evenodd"
                d="M3.25 4A2.75 2.75 0 016 1.25h5.586c.73 0 1.429.29 1.945.806l2.578 2.578c.516.516.805 1.214.805 1.944V16A2.75 2.75 0 0114.25 18.75H6A2.75 2.75 0 013.25 16V4zm8.5 1.25a.75.75 0 00-.75-.75H6A1.25 1.25 0 004.75 4v12c0 .69.56 1.25 1.25 1.25h8.25c.69 0 1.25-.56 1.25-1.25V7.5h-2.75a1 1 0 01-1-1V5.25z"
                clip-rule="evenodd"
              />
            </svg>
          </IconButton>
        </Show>

        <IconButton
          type="button"
          label="Delete"
          title={
            isReadOnly()
              ? 'Read-only mode'
              : !canStartInstance(i.status)
                ? 'Stop the instance before deleting'
                : 'Delete instance'
          }
          variant="danger"
          disabled={isReadOnly() || !canStartInstance(i.status)}
          onClick={() => setConfirmDeleteInstanceId(i.config.instance_id)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
            <path
              fill-rule="evenodd"
              d="M8.75 2.75A.75.75 0 019.5 2h1a.75.75 0 01.75.75V3h3.5a.75.75 0 010 1.5h-.918l-.764 10.694A2.75 2.75 0 0111.327 18H8.673a2.75 2.75 0 01-2.741-2.806L5.168 4.5H4.25a.75.75 0 010-1.5h3.5v-.25zm1.5.25v.25h-1.5V3h1.5z"
              clip-rule="evenodd"
            />
          </svg>
        </IconButton>
      </div>
    </div>
  )
}
