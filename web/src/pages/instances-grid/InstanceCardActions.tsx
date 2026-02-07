import InstanceQuickActions from './InstanceQuickActions'
import InstanceRunActions from './InstanceRunActions'

export type InstanceCardActionsProps = {
  [key: string]: unknown
}

export default function InstanceCardActions(props: InstanceCardActionsProps) {
  const {
    i,
    instanceDisplayName,
    instanceOpById,
    invalidateInstances,
    isReadOnly,
    openEditModal,
    openFileInFiles,
    openInFiles,
    pushToast,
    restartInstance,
    runInstanceOp,
    setConfirmDeleteInstanceId,
    startInstance,
    stopInstance,
    toastError,
  } = props as any

  return (
    <div class="relative z-10 mt-3 flex flex-wrap items-center justify-between gap-2">
      <InstanceRunActions
        i={i}
        instanceDisplayName={instanceDisplayName}
        instanceOpById={instanceOpById}
        invalidateInstances={invalidateInstances}
        isReadOnly={isReadOnly}
        pushToast={pushToast}
        restartInstance={restartInstance}
        runInstanceOp={runInstanceOp}
        startInstance={startInstance}
        stopInstance={stopInstance}
        toastError={toastError}
      />
      <InstanceQuickActions
        i={i}
        isReadOnly={isReadOnly}
        openEditModal={openEditModal}
        openFileInFiles={openFileInFiles}
        openInFiles={openInFiles}
        setConfirmDeleteInstanceId={setConfirmDeleteInstanceId}
      />
    </div>
  )
}
