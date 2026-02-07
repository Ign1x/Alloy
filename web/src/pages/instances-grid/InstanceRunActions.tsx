import { Show } from 'solid-js'
import { canStartInstance, isStopping } from '../../app/helpers/instances'
import { Button } from '../../components/ui/Button'

export type InstanceRunActionsProps = {
  [key: string]: unknown
}

export default function InstanceRunActions(props: InstanceRunActionsProps) {
  const {
    i,
    instanceDisplayName,
    instanceOpById,
    invalidateInstances,
    isReadOnly,
    pushToast,
    restartInstance,
    runInstanceOp,
    startInstance,
    stopInstance,
    toastError,
  } = props as any

  return (
    <div class="flex flex-wrap items-center gap-2">
      <Show
        when={canStartInstance(i.status)}
        fallback={
          <Button
            size="xs"
            variant="secondary"
            leftIcon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                <path d="M5.75 5.75A.75.75 0 016.5 5h7a.75.75 0 01.75.75v8.5a.75.75 0 01-.75.75h-7a.75.75 0 01-.75-.75v-8.5z" />
              </svg>
            }
            loading={instanceOpById()[i.config.instance_id] === 'stopping'}
            disabled={
              isReadOnly() ||
              instanceOpById()[i.config.instance_id] != null ||
              isStopping(i.status)
            }
            title={isReadOnly() ? 'Read-only mode' : 'Stop instance'}
            onClick={async () => {
              try {
                await runInstanceOp(i.config.instance_id, 'stopping', () =>
                  stopInstance.mutateAsync({ instance_id: i.config.instance_id, timeout_ms: 30_000 }),
                )
                await invalidateInstances()
                pushToast('success', 'Stopped', instanceDisplayName(i as any))
              } catch (e) {
                toastError('Stop failed', e)
              }
            }}
          >
            Stop
          </Button>
        }
      >
        <Button
          size="xs"
          variant="primary"
          leftIcon={
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
              <path d="M4.5 3.25a.75.75 0 011.18-.62l10.5 7.25a.75.75 0 010 1.24l-10.5 7.25A.75.75 0 014.5 17.75V3.25z" />
            </svg>
          }
          loading={instanceOpById()[i.config.instance_id] === 'starting'}
          disabled={isReadOnly() || instanceOpById()[i.config.instance_id] != null}
          title={isReadOnly() ? 'Read-only mode' : 'Start instance'}
          onClick={async () => {
            try {
              await runInstanceOp(i.config.instance_id, 'starting', () =>
                startInstance.mutateAsync({ instance_id: i.config.instance_id }),
              )
              await invalidateInstances()
              pushToast('success', 'Started', instanceDisplayName(i as any))
            } catch (e) {
              toastError('Start failed', e)
            }
          }}
        >
          Start
        </Button>
      </Show>

      <Show when={i.status != null}>
        <Button
          size="xs"
          variant="secondary"
          leftIcon={
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
              <path
                fill-rule="evenodd"
                d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466.75.75 0 011.06-1.06 4 4 0 006.764-2.289H13a.75.75 0 010-1.5h2.75a.75.75 0 01.75.75V12.5a.75.75 0 01-1.5 0v-1.076zM4.688 8.576a5.5 5.5 0 019.201-2.466.75.75 0 11-1.06 1.06A4 4 0 006.065 9.46H7a.75.75 0 010 1.5H4.25a.75.75 0 01-.75-.75V7.5a.75.75 0 011.5 0v1.076z"
                clip-rule="evenodd"
              />
            </svg>
          }
          loading={instanceOpById()[i.config.instance_id] === 'restarting'}
          disabled={
            isReadOnly() ||
            instanceOpById()[i.config.instance_id] != null ||
            isStopping(i.status)
          }
          title={isReadOnly() ? 'Read-only mode' : 'Restart instance'}
          onClick={async () => {
            try {
              await runInstanceOp(i.config.instance_id, 'restarting', () =>
                restartInstance.mutateAsync({ instance_id: i.config.instance_id, timeout_ms: 30_000 }),
              )
              await invalidateInstances()
              pushToast('success', 'Restarted', instanceDisplayName(i as any))
            } catch (e) {
              toastError('Restart failed', e)
            }
          }}
        >
          Restart
        </Button>
      </Show>
    </div>
  )
}
