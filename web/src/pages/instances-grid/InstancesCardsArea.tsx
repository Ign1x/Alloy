import { For, Show } from 'solid-js'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import InstanceCard from './InstanceCard'

export type InstancesCardsAreaProps = {
  [key: string]: unknown
}

export default function InstancesCardsArea(props: InstancesCardsAreaProps) {
  const {
    filteredInstances,
    getCreateInstanceNameRef,
    highlightInstanceId,
    instanceCardEls,
    instanceCompact,
    instanceDisplayName,
    instanceOpById,
    instanceStatusKeys,
    instances,
    instancesPollErrorStreak,
    invalidateInstances,
    isReadOnly,
    openEditModal,
    openFileInFiles,
    openInFiles,
    pinnedInstanceIds,
    pushToast,
    restartInstance,
    runInstanceOp,
    selectedInstanceId,
    setConfirmDeleteInstanceId,
    setInstanceDetailTab,
    setSelectedInstanceId,
    setShowInstanceModal,
    startInstance,
    stopInstance,
    toastError,
    togglePinnedInstance,
  } = props as any

  const hasOfflineSnapshot = () =>
    instances.isError &&
    (instances.data ?? []).length > 0 &&
    Number(instancesPollErrorStreak?.() ?? 0) > 0

  return (
    <>
      <Show when={hasOfflineSnapshot()}>
        <div class="mt-4 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
          Control is temporarily disconnected from one or more nodes. Showing cached instances from Control storage.
        </div>
      </Show>

      <Show when={!instances.isError || instances.data != null}>
        <Show
          when={instances.isPending}
          fallback={
            <Show
              when={filteredInstances().length > 0}
              fallback={
                <EmptyState
                  class="mt-4"
                  title={(instances.data ?? []).length === 0 ? 'No instances yet' : 'No matches'}
                  description={
                    (instances.data ?? []).length === 0
                      ? 'Create your first instance to get started.'
                      : 'Try adjusting search or filters.'
                  }
                  actions={
                    (instances.data ?? []).length === 0 ? (
                      <Button
                        variant="primary"
                        size="md"
                        leftIcon={
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                            <path
                              fill-rule="evenodd"
                              d="M10 4.25a.75.75 0 01.75.75v4.25H15a.75.75 0 010 1.5h-4.25V15a.75.75 0 01-1.5 0v-4.25H5a.75.75 0 010-1.5h4.25V5a.75.75 0 01.75-.75z"
                              clip-rule="evenodd"
                            />
                          </svg>
                        }
                        disabled={isReadOnly()}
                        title={isReadOnly() ? 'Read-only mode' : 'Create a new instance'}
                        onClick={() => {
                          try {
                            getCreateInstanceNameRef?.()?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                          } catch {
                            // ignore
                          }
                          queueMicrotask(() => getCreateInstanceNameRef?.()?.focus?.())
                        }}
                      >
                        Create instance
                      </Button>
                    ) : undefined
                  }
                />
              }
            >
              <div class={`mt-4 grid gap-3 ${instanceCompact() ? 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' : 'sm:grid-cols-2 2xl:grid-cols-3'}`}>
                <For each={filteredInstances()}>
                  {(i) => (
                    <InstanceCard
                      i={i}
                      highlightInstanceId={highlightInstanceId}
                      instanceCardEls={instanceCardEls}
                      instanceDisplayName={instanceDisplayName}
                      instanceOpById={instanceOpById}
                      instanceStatusKeys={instanceStatusKeys}
                      invalidateInstances={invalidateInstances}
                      isReadOnly={isReadOnly}
                      openEditModal={openEditModal}
                      openFileInFiles={openFileInFiles}
                      openInFiles={openInFiles}
                      pinnedInstanceIds={pinnedInstanceIds}
                      pushToast={pushToast}
                      restartInstance={restartInstance}
                      runInstanceOp={runInstanceOp}
                      selectedInstanceId={selectedInstanceId}
                      setConfirmDeleteInstanceId={setConfirmDeleteInstanceId}
                      setInstanceDetailTab={setInstanceDetailTab}
                      setSelectedInstanceId={setSelectedInstanceId}
                      setShowInstanceModal={setShowInstanceModal}
                      startInstance={startInstance}
                      stopInstance={stopInstance}
                      toastError={toastError}
                      togglePinnedInstance={togglePinnedInstance}
                    />
                  )}
                </For>
              </div>
            </Show>
          }
        >
          <div class={`mt-4 grid gap-3 ${instanceCompact() ? 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' : 'sm:grid-cols-2 2xl:grid-cols-3'}`}>
            <For each={Array.from({ length: 6 })}>
              {() => <Skeleton class={instanceCompact() ? 'h-28' : 'h-40'} />}
            </For>
          </div>
        </Show>
      </Show>

      {/* Logs are shown in the terminal modal; keep the main view clean. */}
    </>
  )
}
