import { For, Show } from 'solid-js'
import { Button } from '../../components/ui/Button'
import { DataBoundary } from '../../components/ui/DataBoundary'
import { Skeleton } from '../../components/ui/Skeleton'
import InstanceCard from './InstanceCard'

export type InstancesCardsAreaProps = {
  [key: string]: unknown
}

export default function InstancesCardsArea(props: InstancesCardsAreaProps) {
  const {
    filteredInstances,
    focusCreateEntry,
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
    openSettingsTab,
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
    t,
    toastError,
    togglePinnedInstance,
  } = props as any

  const hasOfflineSnapshot = () =>
    instances.isError &&
    (instances.data ?? []).length > 0 &&
    Number(instancesPollErrorStreak?.() ?? 0) >= 4

  const jumpToCreateEntry = () => {
    if (typeof focusCreateEntry === 'function') {
      focusCreateEntry()
      return
    }
    try {
      getCreateInstanceNameRef?.()?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch {}
    queueMicrotask(() => getCreateInstanceNameRef?.()?.focus?.())
  }

  const cardGridClasses = () =>
    instanceCompact()
      ? 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
      : 'sm:grid-cols-2 2xl:grid-cols-3'

  const loadingCardCount = () => (instanceCompact() ? 8 : 6)

  return (
    <>
      <DataBoundary
        t={t}
        class="mt-4"
        loading={instances.isPending}
        error={instances.error}
        errorTitle={t('instances.cards.loadFailed')}
        hasData={(instances.data ?? []).length > 0}
        empty={filteredInstances().length === 0}
        emptyTitle={(instances.data ?? []).length === 0 ? t('instances.cards.emptyTitle') : t('instances.cards.noMatchesTitle')}
        emptyDescription={(instances.data ?? []).length === 0 ? t('instances.cards.emptyDesc') : t('instances.cards.noMatchesDesc')}
        emptyActions={
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
              title={isReadOnly() ? t('header.readOnlyMode') : t('instances.cards.createInstanceTitle')}
              onClick={jumpToCreateEntry}
            >
              {t('instances.cards.createInstance')}
            </Button>
          ) : undefined
        }
        loadingClass="border-0 bg-transparent p-0"
        loadingLines={6}
        loadingFallback={
          <div class={`grid gap-3 ${cardGridClasses()} xl:gap-4`}>
            <For each={Array.from({ length: loadingCardCount() })}>
              {() => (
                <div class="surface-card rounded-2xl p-4">
                  <div class="min-h-[11rem]">
                    <Skeleton lines={7} />
                  </div>
                </div>
              )}
            </For>
          </div>
        }
        onRetry={() => void invalidateInstances()}
        onOpenSettings={openSettingsTab}
        settingsCtaLabel={t('tab.settings')}
        stale={{
          show: hasOfflineSnapshot(),
          title: t('instances.cards.refreshFailedTitle'),
          message: t('instances.cards.refreshFailedMessage'),
          onRetry: () => void invalidateInstances(),
        }}
      >
        <Show when={filteredInstances().length > 0}>
          <div class={`grid gap-3 ${cardGridClasses()} xl:gap-4`}>
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
                  t={t}
                  toastError={toastError}
                  togglePinnedInstance={togglePinnedInstance}
                />
              )}
            </For>
          </div>
        </Show>
      </DataBoundary>
    </>
  )
}
