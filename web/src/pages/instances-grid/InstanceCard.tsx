import { Show } from 'solid-js'
import { statusMessageParts } from '../../app/helpers/agentErrors'
import { formatBytes, formatCpuPercent, parseU64 } from '../../app/helpers/format'
import { instanceCardBackdrop } from '../../app/helpers/instances'
import InstanceCardActions from './InstanceCardActions'
import InstanceCardHeader from './InstanceCardHeader'

export type InstanceCardProps = {
  [key: string]: unknown
}

export default function InstanceCard(props: InstanceCardProps) {
  const {
    i,
    highlightInstanceId,
    instanceCardEls,
    instanceDisplayName,
    instanceOpById,
    instanceStatusKeys,
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

  return (
    <div
      ref={(el) => instanceCardEls.set(i.config.instance_id, el)}
      class={`group relative overflow-hidden rounded-2xl border border-slate-200 bg-white/50 p-4 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:bg-white/58 hover:shadow-md active:scale-[0.99] dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none dark:hover:bg-slate-950/60 ${
        selectedInstanceId() === i.config.instance_id
          ? 'ring-1 ring-amber-500/25'
          : highlightInstanceId() === i.config.instance_id
            ? 'ring-2 ring-emerald-400/25'
            : 'ring-0 ring-transparent'
      }`}
    >
      <Show when={instanceCardBackdrop(i.config.template_id)}>
        {(bg) => (
          <>
            <img
              src={bg().src}
              alt=""
              aria-hidden="true"
              class="pointer-events-none absolute inset-0 h-full w-full select-none object-cover opacity-[0.5] saturate-115 contrast-115 blur-[1.2px] transition-transform duration-300 group-hover:scale-[1.06] dark:opacity-[0.38]"
              style={{ 'object-position': bg().position }}
              loading="lazy"
              decoding="async"
            />
            <div class="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-r from-white/68 via-white/34 to-white/8 dark:from-slate-950/90 dark:via-slate-950/74 dark:to-slate-950/50" />
            <div class="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-transparent to-white/6 dark:to-slate-950/18" />
            <div class="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(130%_92%_at_86%_56%,rgba(15,23,42,0)_36%,rgba(15,23,42,0.22)_100%)] dark:bg-[radial-gradient(130%_92%_at_86%_56%,rgba(2,6,23,0)_26%,rgba(2,6,23,0.55)_100%)]" />
            <div class="pointer-events-none absolute inset-x-0 bottom-0 h-24 rounded-b-2xl bg-gradient-to-t from-white/54 via-white/34 to-transparent dark:from-slate-950/78 dark:via-slate-950/64 dark:to-transparent" />
          </>
        )}
      </Show>

      <div
        class="relative z-10 w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950"
        data-instance-card-focus="true"
        role="button"
        tabIndex={0}
        onClick={() => {
          setSelectedInstanceId(i.config.instance_id)
          setInstanceDetailTab('logs')
          setShowInstanceModal(true)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          setSelectedInstanceId(i.config.instance_id)
          setInstanceDetailTab('logs')
          setShowInstanceModal(true)
        }}
      >
        <InstanceCardHeader
          i={i}
          instanceDisplayName={instanceDisplayName}
          instanceStatusKeys={instanceStatusKeys}
          pinnedInstanceIds={pinnedInstanceIds}
          pushToast={pushToast}
          togglePinnedInstance={togglePinnedInstance}
        />
      </div>

      <Show
        when={
          i.status?.state === 'PROCESS_STATE_FAILED' &&
          (i.status?.message != null || i.status?.exit_code != null)
        }
      >
        <div class="relative z-10 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
          <span class="font-semibold">Failed:</span>
          <span class="ml-1">
            <Show when={i.status?.exit_code != null}>
              exit {i.status?.exit_code}
            </Show>
            <Show when={i.status?.message != null}>
              <span class="ml-2">{statusMessageParts(i.status).text}</span>
            </Show>
          </span>
          <Show when={statusMessageParts(i.status).hint}>
            {(hint) => (
              <div class="mt-1 text-[11px] text-rose-700/80 dark:text-rose-200/70">
                {hint()}
              </div>
            )}
          </Show>
        </div>
      </Show>

      <Show when={i.status?.resources}>
        {(r) => (
          <div class="relative z-10 mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40">
              cpu {formatCpuPercent(r().cpu_percent_x100)}
            </span>
            <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40">
              rss {formatBytes(parseU64(r().rss_bytes))}
            </span>
            <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40">
              io {formatBytes(parseU64(r().read_bytes))}↓ {formatBytes(parseU64(r().write_bytes))}↑
            </span>
          </div>
        )}
      </Show>

      <InstanceCardActions
        i={i}
        instanceDisplayName={instanceDisplayName}
        instanceOpById={instanceOpById}
        invalidateInstances={invalidateInstances}
        isReadOnly={isReadOnly}
        openEditModal={openEditModal}
        openFileInFiles={openFileInFiles}
        openInFiles={openInFiles}
        pushToast={pushToast}
        restartInstance={restartInstance}
        runInstanceOp={runInstanceOp}
        setConfirmDeleteInstanceId={setConfirmDeleteInstanceId}
        startInstance={startInstance}
        stopInstance={stopInstance}
        toastError={toastError}
      />
    </div>
  )
}
