import { Show } from 'solid-js'
import { canStartInstance, isStopping } from '../../app/helpers/instances'
import { restartInstanceActionTitle, startInstanceActionTitle, stopInstanceActionTitle } from '../../app/helpers/instanceActionReasons'
import { isAlloyApiError } from '../../rspc'
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
    toastSuccessFromRspc,
    restartInstance,
    runInstanceOp,
    startInstance,
    stopInstance,
    t,
    toastError,
  } = props as any

  const instanceContext = {
    scope: 'instance' as const,
    id: i.config.instance_id,
    label: instanceDisplayName(i as any),
  }

  const operationInProgress = () => instanceOpById()[i.config.instance_id] != null

  const stopTitle = () =>
    stopInstanceActionTitle({
      status: i.status,
      isReadOnly: isReadOnly(),
      operationInProgress: operationInProgress(),
      t,
    })

  const startTitle = () =>
    startInstanceActionTitle({
      status: i.status,
      isReadOnly: isReadOnly(),
      operationInProgress: operationInProgress(),
      t,
    })

  const restartTitle = () =>
    restartInstanceActionTitle({
      status: i.status,
      isReadOnly: isReadOnly(),
      operationInProgress: operationInProgress(),
      t,
    })

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
            title={stopTitle()}
            onClick={async () => {
              try {
                await runInstanceOp(i.config.instance_id, 'stopping', () =>
                  stopInstance.mutateAsync({ instance_id: i.config.instance_id, timeout_ms: 30_000 }),
                )
                await invalidateInstances()
                toastSuccessFromRspc('instance.stop', t('instances.toast.stopped'), instanceDisplayName(i as any), {
                  context: instanceContext,
                })
              } catch (e) {
                if (isAlloyApiError(e) && e.data.hint) {
                  pushToast('info', t('instances.toast.hint'), e.data.hint, e.data.request_id, {
                    context: instanceContext,
                  })
                }
                toastError(t('instances.toast.stopFailed'), e, {
                  context: instanceContext,
                })
              }
            }}
          >
            {t('instances.actions.stop')}
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
          title={startTitle()}
          onClick={async () => {
            try {
                await runInstanceOp(i.config.instance_id, 'starting', () =>
                  startInstance.mutateAsync({ instance_id: i.config.instance_id }),
                )
                await invalidateInstances()
                toastSuccessFromRspc('instance.start', t('instances.toast.started'), instanceDisplayName(i as any), {
                  context: instanceContext,
                })
            } catch (e) {
                if (isAlloyApiError(e) && e.data.hint) {
                  pushToast('info', t('instances.toast.hint'), e.data.hint, e.data.request_id, {
                    context: instanceContext,
                  })
                }
                toastError(t('instances.toast.startFailed'), e, {
                  context: instanceContext,
                })
              }
          }}
        >
          {t('instances.actions.start')}
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
          title={restartTitle()}
          onClick={async () => {
            try {
                await runInstanceOp(i.config.instance_id, 'restarting', () =>
                  restartInstance.mutateAsync({ instance_id: i.config.instance_id, timeout_ms: 30_000 }),
                )
                await invalidateInstances()
                toastSuccessFromRspc('instance.restart', t('instances.toast.restarted'), instanceDisplayName(i as any), {
                  context: instanceContext,
                })
            } catch (e) {
              if (isAlloyApiError(e) && e.data.hint) {
                pushToast('info', t('instances.toast.hint'), e.data.hint, e.data.request_id, {
                  context: instanceContext,
                })
              }
              toastError(t('instances.toast.restartFailed'), e, {
                context: instanceContext,
              })
            }
          }}
        >
          {t('instances.actions.restart')}
        </Button>
      </Show>
    </div>
  )
}
