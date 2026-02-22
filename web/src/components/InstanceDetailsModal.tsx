import { createSignal, For, Show } from 'solid-js'
import { ensureCsrfCookie } from '../auth'
import { statusMessageParts } from '../app/helpers/agentErrors'
import { formatBytes, formatCpuPercent, parseU64 } from '../app/helpers/format'
import {
  canEditOrDeleteInstance,
  deleteInstanceActionTitle,
  editInstanceActionTitle,
  restartInstanceActionTitle,
  startInstanceActionTitle,
  stopInstanceActionTitle,
} from '../app/helpers/instanceActionReasons'
import { canStartInstance, instanceStateLabel, isStopping } from '../app/helpers/instances'
import { buildDirectConnectAddress, instancePort, parseFrpEndpoint, parseFrpPublicEndpoint } from '../app/helpers/network'
import { downloadJson, isSecretParamKey, safeCopy } from '../app/helpers/misc'
import { templateDisplayLabel, templateLogoSrc } from '../app/helpers/templateBrand'
import { StartProgress } from '../app/primitives/StartProgress'
import { isAlloyApiError } from '../rspc'
import { FileBrowser } from './FileBrowser'
import { LogViewer } from './LogViewer'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { ErrorState } from './ui/ErrorState'
import { GameAvatar } from './ui/GameAvatar'
import { IconButton } from './ui/IconButton'
import { Input } from './ui/Input'
import { Modal } from './ui/Modal'
import { Tabs } from './ui/Tabs'

export type InstanceDetailsModalProps = {
  [key: string]: unknown
}

export default function InstanceDetailsModal(props: InstanceDetailsModalProps) {
  const {
    showInstanceModal,
    selectedInstanceId,
    setShowInstanceModal,
    selectedInstanceDisplayName,
    selectedInstance,
    instanceDisplayName,
    pushToast,
    instanceDiagnostics,
    processLogLines,
    toastError,
    instanceOpById,
    isReadOnly,
    runInstanceOp,
    stopInstance,
    invalidateInstances,
    startInstance,
    restartInstance,
    openEditModal,
    setConfirmDeleteInstanceId,
    instanceDetailTab,
    setInstanceDetailTab,
    selectedInstanceMessage,
    saveSearchQuery,
    setSaveSearchQuery,
    importSaveFromSearch,
    instanceSaveSearch,
    processLogsTail,
    canTailProcessLogs: canTailProcessLogsProp,
    processLogLive,
    setProcessLogLive,
    setProcessLogLines,
    isAuthed,
    t,
    toastSuccessFromRspc,
    locale,
  } = props as any

  const canTailProcessLogs = () => (typeof canTailProcessLogsProp === 'function' ? Boolean(canTailProcessLogsProp()) : true)

  const selectedTemplateId = () => {
    const current = selectedInstance()
    return current?.config?.template_id ?? ''
  }

  const selectedTemplateLabel = () => templateDisplayLabel(selectedTemplateId())

  const modalTitle = () => (
    <span class="flex min-w-0 items-center gap-2">
      <GameAvatar
        name={selectedTemplateLabel()}
        src={templateLogoSrc(selectedTemplateId())}
        title={selectedTemplateLabel()}
      />
      <span class="truncate">{selectedInstanceDisplayName() ?? t('instances.details.title')}</span>
    </span>
  )

  return (
	        <Modal
	          open={showInstanceModal() && selectedInstanceId() != null}
	          onClose={() => setShowInstanceModal(false)}
	          title={modalTitle()}
	          size="xl"
	        >
          <Show when={selectedInstance()} fallback={<div class="text-sm text-slate-500">{t('instances.details.noSelection')}</div>}>
	            {(inst) => {
	              const id = () => inst().config.instance_id
              const status = () => inst().status ?? null
              const displayName = () => instanceDisplayName(inst() as any)
              const uiName = () => selectedInstanceDisplayName() ?? displayName()
              const operationInProgress = () => instanceOpById()[id()] != null
              const params = () => (inst().config.params as Record<string, unknown> | null | undefined) ?? null
	              const version = () => {
	                const v = params()?.version
	                return typeof v === 'string' && v.trim() ? v : null
	              }
              const port = () => instancePort(inst() as any)
              const connectInfo = () => {
                const p = port()
                if (!p) return null
                const raw = params()?.frp_config
                if (typeof raw === 'string') {
                  const viaFrp = parseFrpPublicEndpoint(raw, p)
                  if (viaFrp) return viaFrp
                }
                return buildDirectConnectAddress(p, inst().config)
              }
              const frpEndpoint = () => {
                const raw = params()?.frp_config
                if (typeof raw !== 'string') return null
                return parseFrpEndpoint(raw)
              }

              const canSearchSaveImport = () => {
                const templateId = inst().config.template_id
                return (
                  templateId === 'minecraft:vanilla' ||
                  templateId === 'minecraft:modrinth' ||
                  templateId === 'minecraft:import' ||
                  templateId === 'minecraft:curseforge'
                )
              }

              const [uploadSaveFile, setUploadSaveFile] = createSignal<File | null>(null)
              const [uploadSavePending, setUploadSavePending] = createSignal(false)
              let uploadSaveInputRef: HTMLInputElement | undefined

              const [revealedSecrets, setRevealedSecrets] = createSignal<Record<string, boolean>>({})

              const statusVariant = () => {
                const s = status()?.state
                if (s === 'PROCESS_STATE_RUNNING') return 'success' as const
                if (s === 'PROCESS_STATE_FAILED') return 'danger' as const
                if (s === 'PROCESS_STATE_STARTING' || s === 'PROCESS_STATE_STOPPING') return 'warning' as const
                return 'neutral' as const
              }

              const instanceToastContext = () => ({
                scope: 'instance' as const,
                id: id(),
                label: uiName(),
              })

              async function copyConnect() {
                const c = connectInfo()
                if (!c) return
                await safeCopy(c)
                pushToast('success', t('toast.copied'), c, undefined, {
                  context: instanceToastContext(),
                })
              }

              async function copyFrp() {
                const c = frpEndpoint()
                if (!c) return
                await safeCopy(c)
                pushToast('success', t('toast.copied'), c, undefined, {
                  context: instanceToastContext(),
                })
              }

              async function downloadDiagnostics() {
                const instValue = inst()
                try {
                  const currentLocale = typeof locale === 'function' ? locale() : 'en'
                  const cfg = {
                    ...instValue.config,
                    params: { ...(instValue.config.params as Record<string, string>) },
                  }
                  for (const [k, v] of Object.entries(cfg.params)) {
                    if (isSecretParamKey(k)) {
                      if (typeof v === 'string' && v) cfg.params[k] = '<redacted>'
                    }
                  }

                  const diag = await instanceDiagnostics.mutateAsync({
                    instance_id: instValue.config.instance_id,
                    max_lines: 600,
                    limit_bytes: 512 * 1024,
                  })

                  const payload = {
                    type: 'alloy-instance-diagnostics',
                    locale: currentLocale,
                    ...diag,
                    config: cfg,
                    status: instValue.status ?? null,
                    process_logs_tail: processLogLines().map((l: any) => l.text),
                  }

                  downloadJson(`alloy-${instValue.config.instance_id}-diagnostics.json`, payload)
                  pushToast('success', t('toast.copied'), t('header.diagnostics'), undefined, {
                    context: instanceToastContext(),
                  })
                } catch (e) {
                  toastError(t('instances.details.loadLogsFailed'), e, {
                    context: instanceToastContext(),
                  })
                }
              }

              async function copyDiagnostics() {
                const instValue = inst()
                try {
                  const currentLocale = typeof locale === 'function' ? locale() : 'en'
                  const cfg = {
                    ...instValue.config,
                    params: { ...(instValue.config.params as Record<string, string>) },
                  }
                  for (const [k, v] of Object.entries(cfg.params)) {
                    if (isSecretParamKey(k)) {
                      if (typeof v === 'string' && v) cfg.params[k] = '<redacted>'
                    }
                  }
                  const payload = {
                    locale: currentLocale,
                    instance_id: instValue.config.instance_id,
                    template_id: instValue.config.template_id,
                    config: cfg,
                    status: instValue.status ?? null,
                    process_logs_tail: processLogLines().map((l: any) => l.text)
                  }
                  await safeCopy(JSON.stringify(payload, null, 2))
                  pushToast('success', t('toast.copied'), t('header.diagnostics'), undefined, {
                    context: instanceToastContext(),
                  })
                } catch (e) {
                  toastError(t('instances.details.loadLogsFailed'), e, {
                    context: instanceToastContext(),
                  })
                }
              }

              return (
                <div class="space-y-4">
                  <div
                    class="-mx-5 -mt-4 border-b border-slate-200 bg-white/60 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/50"
                  >
                    <div class="flex flex-wrap items-center justify-between gap-3">
                      <div class="min-w-0">
	                        <div class="mt-1 flex flex-wrap items-center gap-2">
	                          <Badge variant={statusVariant()} title={status()?.state ?? 'PROCESS_STATE_EXITED'}>
                                {instanceStateLabel(status(), t)}
	                          </Badge>
	                          <Show when={version()}>{(v) => <Badge variant="neutral">v{v()}</Badge>}</Show>
                          <Show when={connectInfo()}>
                            {(c) => (
                              <button
                                type="button"
                                class="group inline-flex max-w-full cursor-pointer items-center gap-1 rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono text-[11px] text-slate-700 transition-all duration-150 hover:bg-white active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:bg-slate-900 dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950"
                                onClick={() => void copyConnect()}
                                title={t('toast.copied')}
                              >
                                <span class="truncate">{c()}</span>
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                  class="h-3 w-3 flex-none opacity-60 group-hover:opacity-100"
                                  aria-hidden="true"
                                >
                                  <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                                  <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                                </svg>
                              </button>
                            )}
                          </Show>
                          <Show when={frpEndpoint()}>
                            {(c) => (
                              <button
                                type="button"
                                class="group inline-flex max-w-full cursor-pointer items-center gap-1 rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono text-[11px] text-slate-700 transition-all duration-150 hover:bg-white active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:bg-slate-900 dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950"
                                onClick={() => void copyFrp()}
                                 title={t('toast.copied')}
                              >
                                <span class="truncate">{t('instances.details.tunnelPrefix', { value: c() })}</span>
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                  class="h-3 w-3 flex-none opacity-60 group-hover:opacity-100"
                                  aria-hidden="true"
                                >
                                  <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                                  <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                                </svg>
                              </button>
                            )}
                          </Show>
                        </div>

                        <Show when={status()?.state === 'PROCESS_STATE_STARTING' ? status()?.message?.trim() : null}>
                          {(msg) => <StartProgress templateId={inst().config.template_id} message={msg()} />}
                        </Show>
                      </div>

                      <div class="flex flex-wrap items-center justify-end gap-2">
                        <Show
                          when={canStartInstance(status())}
                          fallback={
	                            <Button
	                              size="xs"
	                              variant="secondary"
	                              leftIcon={
	                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                                  <path d="M5.75 5.75A.75.75 0 016.5 5h7a.75.75 0 01.75.75v8.5a.75.75 0 01-.75.75h-7a.75.75 0 01-.75-.75v-8.5z" />
	                                </svg>
	                              }
	                            loading={instanceOpById()[id()] === 'stopping'}
	                            disabled={isReadOnly() || instanceOpById()[id()] != null || isStopping(status())}
	                            title={stopInstanceActionTitle({ status: status(), isReadOnly: isReadOnly(), operationInProgress: operationInProgress(), t })}
	                          onClick={async () => {
	                              try {
	                                await runInstanceOp(id(), 'stopping', () =>
	                                  stopInstance.mutateAsync({ instance_id: id(), timeout_ms: 30_000 }),
	                                )
	                                await invalidateInstances()
	                                toastSuccessFromRspc('instance.stop', t('instances.toast.stopped'), uiName(), {
                                  context: instanceToastContext(),
                                })
                              } catch (e) {
                                if (isAlloyApiError(e) && e.data.hint) {
	                                  pushToast('info', t('instances.toast.hint'), e.data.hint, e.data.request_id, {
                                    context: instanceToastContext(),
                                  })
                                }
	                                toastError(t('instances.toast.stopFailed'), e, {
                                  context: instanceToastContext(),
                                  retry: { key: `instance.stop:${id()}` },
                                  onRetry: () =>
                                    runInstanceOp(id(), 'stopping', () => stopInstance.mutateAsync({ instance_id: id(), timeout_ms: 30_000 })).then(
                                      () => void invalidateInstances(),
                                    ),
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
	                            loading={instanceOpById()[id()] === 'starting'}
	                            disabled={isReadOnly() || instanceOpById()[id()] != null}
	                            title={startInstanceActionTitle({ status: status(), isReadOnly: isReadOnly(), operationInProgress: operationInProgress(), t })}
	                            onClick={async () => {
	                              try {
	                                await runInstanceOp(id(), 'starting', () => startInstance.mutateAsync({ instance_id: id() }))
	                                await invalidateInstances()
	                                toastSuccessFromRspc('instance.start', t('instances.toast.started'), uiName(), {
                                  context: instanceToastContext(),
                                })
                              } catch (e) {
                                if (isAlloyApiError(e) && e.data.hint) {
	                                  pushToast('info', t('instances.toast.hint'), e.data.hint, e.data.request_id, {
                                    context: instanceToastContext(),
                                  })
                                }
	                                toastError(t('instances.toast.startFailed'), e, {
                                  context: instanceToastContext(),
                                  retry: { key: `instance.start:${id()}` },
                                  onRetry: () =>
                                    runInstanceOp(id(), 'starting', () => startInstance.mutateAsync({ instance_id: id() })).then(
                                      () => void invalidateInstances(),
                                    ),
                                })
                              }
                            }}
	                          >
	                            {t('instances.actions.start')}
                          </Button>
                        </Show>

                        <Show when={status() != null}>
	                          <IconButton
	                            type="button"
	                            label={t('instances.actions.restart')}
	                            title={restartInstanceActionTitle({ status: status(), isReadOnly: isReadOnly(), operationInProgress: operationInProgress(), t })}
	                            variant="secondary"
	                            disabled={isReadOnly() || instanceOpById()[id()] != null}
	                            onClick={async () => {
	                              try {
	                                await runInstanceOp(id(), 'restarting', () =>
	                                  restartInstance.mutateAsync({ instance_id: id(), timeout_ms: 30_000 }),
	                                )
	                                await invalidateInstances()
	                                toastSuccessFromRspc('instance.restart', t('instances.toast.restarted'), uiName(), {
                                  context: instanceToastContext(),
                                })
                              } catch (e) {
                                if (isAlloyApiError(e) && e.data.hint) {
	                                  pushToast('info', t('instances.toast.hint'), e.data.hint, e.data.request_id, {
                                    context: instanceToastContext(),
                                  })
                                }
	                                toastError(t('instances.toast.restartFailed'), e, {
                                  context: instanceToastContext(),
                                  retry: { key: `instance.restart:${id()}` },
                                  onRetry: () =>
                                    runInstanceOp(id(), 'restarting', () =>
                                      restartInstance.mutateAsync({ instance_id: id(), timeout_ms: 30_000 }),
                                    ).then(() => void invalidateInstances()),
                                })
                              }
                            }}
	                          >
	                            <Show
	                              when={instanceOpById()[id()] === 'restarting'}
	                              fallback={
	                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                                  <path
	                                    fill-rule="evenodd"
	                                    d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466.75.75 0 011.06-1.06 4 4 0 006.764-2.289H13a.75.75 0 010-1.5h2.75a.75.75 0 01.75.75V12.5a.75.75 0 01-1.5 0v-1.076zM4.688 8.576a5.5 5.5 0 019.201-2.466.75.75 0 11-1.06 1.06A4 4 0 006.065 9.46H7a.75.75 0 010 1.5H4.25a.75.75 0 01-.75-.75V7.5a.75.75 0 011.5 0v1.076z"
	                                    clip-rule="evenodd"
	                                  />
	                                </svg>
	                              }
	                            >
	                              <svg
	                                class="h-4 w-4 animate-spin"
	                                viewBox="0 0 24 24"
	                                fill="none"
	                                xmlns="http://www.w3.org/2000/svg"
	                                role="status"
	                                aria-label={t('instances.details.restartingAria')}
	                              >
	                                <path d="M12 3a9 9 0 1 0 9 9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="opacity-25" />
	                                <path
	                                  d="M21 12a9 9 0 0 0-9-9"
	                                  stroke="currentColor"
	                                  stroke-width="2.5"
	                                  stroke-linecap="round"
	                                  class="origin-center"
	                                />
	                              </svg>
	                            </Show>
	                          </IconButton>
                        </Show>

	                        <IconButton
	                          type="button"
	                          label={t('instances.details.downloadReport')}
	                          title={t('instances.details.downloadReport')}
	                          variant="secondary"
	                          disabled={instanceDiagnostics.isPending || selectedInstance() == null}
	                          onClick={() => void downloadDiagnostics()}
	                        >
	                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                            <path
	                              fill-rule="evenodd"
	                              d="M3.75 3A1.75 1.75 0 002 4.75v10.5C2 16.216 2.784 17 3.75 17h8.5A1.75 1.75 0 0014 15.25V7.5a.75.75 0 00-.22-.53l-3.75-3.75A.75.75 0 009.5 3H3.75zm6.5 1.56L12.44 6.75h-1.69a.5.5 0 01-.5-.5V4.56z"
	                              clip-rule="evenodd"
	                            />
	                          </svg>
	                        </IconButton>
	                        <IconButton
	                          type="button"
	                          label={t('instances.details.copyDiagnosticsJson')}
	                          title={t('instances.details.copyDiagnosticsJson')}
	                          variant="secondary"
	                          disabled={selectedInstance() == null}
	                          onClick={() => void copyDiagnostics()}
	                        >
	                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                            <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
	                            <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
	                          </svg>
	                        </IconButton>

	                        <IconButton
	                          type="button"
	                          label={t('instances.actions.edit')}
	                          title={editInstanceActionTitle({ status: status(), isReadOnly: isReadOnly(), t })}
	                          variant="secondary"
	                          disabled={!canEditOrDeleteInstance(status(), isReadOnly())}
	                          onClick={() => {
	                            setShowInstanceModal(false)
	                            openEditModal(inst())
	                          }}
	                        >
	                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-9.5 9.5a1 1 0 01-.39.242l-3.5 1.166a.5.5 0 01-.632-.632l1.166-3.5a1 1 0 01.242-.39l9.5-9.5z" />
	                          </svg>
	                        </IconButton>
	                        <IconButton
	                          type="button"
	                          label={t('instances.actions.delete')}
	                          title={deleteInstanceActionTitle({ status: status(), isReadOnly: isReadOnly(), t })}
	                          variant="danger"
	                          disabled={!canEditOrDeleteInstance(status(), isReadOnly())}
	                          onClick={() => {
	                            setShowInstanceModal(false)
	                            setConfirmDeleteInstanceId(id())
	                          }}
	                        >
	                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                            <path
	                              fill-rule="evenodd"
	                              d="M8.75 2.75A.75.75 0 019.5 2h1a.75.75 0 01.75.75V3h3.5a.75.75 0 010 1.5h-.918l-.764 10.694A2.75 2.75 0 0111.327 18H8.673a2.75 2.75 0 01-2.741-2.806L5.168 4.5H4.25a.75.75 0 010-1.5h3.5v-.25zm1.5.25v.25h-1.5V3h1.5z"
	                              clip-rule="evenodd"
	                            />
	                          </svg>
	                        </IconButton>

                        <IconButton type="button" label={t('instances.details.close')} variant="ghost" onClick={() => setShowInstanceModal(false)}>
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                            <path
                              fill-rule="evenodd"
                              d="M4.47 4.47a.75.75 0 011.06 0L10 8.94l4.47-4.47a.75.75 0 111.06 1.06L11.06 10l4.47 4.47a.75.75 0 11-1.06 1.06L10 11.06l-4.47 4.47a.75.75 0 11-1.06-1.06L8.94 10 4.47 5.53a.75.75 0 010-1.06z"
                              clip-rule="evenodd"
                            />
                          </svg>
                        </IconButton>
                      </div>
                    </div>

                    <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <Tabs
                        value={instanceDetailTab()}
                        options={[
                          { value: 'overview', label: t('instances.details.tabOverview') },
                          { value: 'logs', label: t('instances.details.tabLogs') },
                          { value: 'files', label: t('instances.details.tabFiles') },
                          { value: 'config', label: t('instances.details.tabConfig') },
                        ]}
                        onChange={setInstanceDetailTab}
                      />
                    </div>
                  </div>

                  <Show when={instanceDetailTab() === 'overview'}>
                    <div class="space-y-4">
                      <div class="grid gap-4 lg:grid-cols-2">
                        <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                          <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t('instances.details.statusHeading')}
                          </div>
                          <div class="mt-3 space-y-2 text-[12px] text-slate-600 dark:text-slate-300">
                            <div class="flex items-center justify-between gap-3">
                              <div class="text-slate-500 dark:text-slate-400">{t('instances.details.state')}</div>
                              <div class="font-mono text-[11px]">{status()?.state ?? 'PROCESS_STATE_EXITED'}</div>
                            </div>
                            <Show when={status()?.pid != null}>
                              <div class="flex items-center justify-between gap-3">
                                <div class="text-slate-500 dark:text-slate-400">{t('instances.details.pid')}</div>
                                <div class="font-mono text-[11px]">{status()?.pid}</div>
                              </div>
                            </Show>
                            <Show when={status()?.exit_code != null}>
                              <div class="flex items-center justify-between gap-3">
                                <div class="text-slate-500 dark:text-slate-400">{t('instances.details.exit')}</div>
                                <div class="font-mono text-[11px]">{status()?.exit_code}</div>
                              </div>
                            </Show>
                          </div>

                          <Show when={status()?.message != null}>
                            <div class="mt-3 rounded-xl border border-slate-200 bg-white/60 p-3 text-[12px] text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
                              <div class="font-semibold">{t('instances.details.messageHeading')}</div>
                              <div class="mt-1 font-mono text-[11px] whitespace-pre-wrap">{selectedInstanceMessage() ?? ''}</div>
                              <Show when={statusMessageParts(status()).hint}>
                                {(hint) => (
                                  <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{hint()}</div>
                                )}
                              </Show>
                            </div>
                          </Show>
                        </div>

                        <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                          <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t('instances.details.resourcesHeading')}
                          </div>
                          <Show
                            when={status()?.resources}
                            fallback={<div class="mt-3 text-[12px] text-slate-500">{t('instances.details.noResourceData')}</div>}
                          >
                            {(r) => (
                              <div class="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
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
                        </div>
                      </div>

                      <Show
                        when={
                          inst().config.template_id === 'minecraft:vanilla' ||
                          inst().config.template_id === 'minecraft:modrinth' ||
                          inst().config.template_id === 'minecraft:import' ||
                          inst().config.template_id === 'minecraft:curseforge' ||
                          inst().config.template_id === 'terraria:vanilla' ||
                          inst().config.template_id === 'dst:vanilla'
                        }
                      >
                        <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                          <div class="flex items-center justify-between gap-3">
                            <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                              {t('instances.details.saveHeading')}
                            </div>
                            <Show
                              when={canStartInstance(status())}
                              fallback={<Badge variant="warning">{t('instances.details.stopToImport')}</Badge>}
                            >
                              <Badge variant="neutral">{t('instances.details.searchImport')}</Badge>
                            </Show>
                          </div>

                          <div class="mt-2 text-[12px] text-slate-600 dark:text-slate-300">
                            <Show
                              when={canSearchSaveImport()}
                              fallback={
                                <Show
                                  when={inst().config.template_id === 'dst:vanilla'}
                                  fallback={<span>{t('instances.details.terrariaImportUnavailable')}</span>}
                                >
                                  <span>{t('instances.details.dstImportUnavailable')}</span>
                                </Show>
                              }
                            >
                              <span>{t('instances.details.searchImportDesc')}</span>
                            </Show>
                          </div>

                          <Show
                            when={canSearchSaveImport()}
                            fallback={<div class="mt-3 text-[11px] text-slate-500 dark:text-slate-400">{t('instances.details.saveUploadUnsupported')}</div>}
                          >
                            <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                              <Input
                                value={saveSearchQuery()}
                                onInput={(e) => setSaveSearchQuery(e.currentTarget.value)}
                                placeholder={t('instances.details.worldSearchPlaceholder')}
                                spellcheck={false}
                                class="flex-1"
                                leftIcon={
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                    <path
                                      fill-rule="evenodd"
                                      d="M8.5 3a5.5 5.5 0 014.473 8.698l3.414 3.414a.75.75 0 11-1.06 1.06l-3.415-3.414A5.5 5.5 0 118.5 3zm0 1.5a4 4 0 100 8 4 4 0 000-8z"
                                      clip-rule="evenodd"
                                    />
                                  </svg>
                                }
                              />
                            </div>

                            <Show when={saveSearchQuery().trim().length >= 2 && instanceSaveSearch.isPending}>
                              <div class="mt-3 text-[11px] text-slate-500 dark:text-slate-400">{t('instances.details.searching')}</div>
                            </Show>
                            <Show when={saveSearchQuery().trim().length >= 2 && instanceSaveSearch.isError}>
                              <div class="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300">
                                {t('instances.details.searchFailed')}
                              </div>
                            </Show>
                            <Show when={(instanceSaveSearch.data?.results?.length ?? 0) > 0}>
                              <div class="mt-3 max-h-56 space-y-2 overflow-auto pr-1">
                                <For each={instanceSaveSearch.data?.results ?? []}>
                                  {(result: any) => (
                                    <div class="rounded-xl border border-slate-200 bg-white/80 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
                                      <div class="flex items-start justify-between gap-3">
                                        <div class="min-w-0">
                                          <div class="truncate text-[12px] font-semibold text-slate-800 dark:text-slate-100">{result.title}</div>
                                          <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                            {t('instances.details.resultBy', { author: result.author, provider: result.provider })}
                                          </div>
                                          <Show when={result.summary}>
                                            <div class="mt-1 line-clamp-2 text-[11px] text-slate-600 dark:text-slate-300">{result.summary}</div>
                                          </Show>
                                        </div>
                                        <Button
                                          size="xs"
                                          variant="secondary"
                                          disabled={isReadOnly() || !canStartInstance(status()) || importSaveFromSearch.isPending}
                                          loading={importSaveFromSearch.isPending}
                                          onClick={async () => {
                                            try {
                                              const out = await importSaveFromSearch.mutateAsync({
                                                instance_id: id(),
                                                provider: result.provider,
                                                project_id: result.project_id,
                                                version_id: result.version_id,
                                              })
                                              pushToast('success', t('instances.details.imported'), out.message || out.installed_path, undefined, {
                                                context: instanceToastContext(),
                                              })
                                              setSaveSearchQuery('')
                                            } catch (e) {
                                              toastError(t('instances.details.importFailed'), e, {
                                                context: instanceToastContext(),
                                              })
                                            }
                                          }}
                                        >
                                          {t('instances.details.importAction')}
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </Show>
                            <Show
                              when={
                                saveSearchQuery().trim().length >= 2 &&
                                !instanceSaveSearch.isPending &&
                                !instanceSaveSearch.isError &&
                                (instanceSaveSearch.data?.results?.length ?? 0) === 0
                              }
                            >
                              <div class="mt-3 text-[11px] text-slate-500 dark:text-slate-400">{t('instances.details.noMatchingWorlds')}</div>
                            </Show>

                            <div class="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
                              <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                {t('instances.details.uploadZipWorld')}
                              </div>
                              <div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                                <input
                                  ref={(el) => {
                                    uploadSaveInputRef = el
                                  }}
                                  type="file"
                                  accept=".zip,application/zip,application/x-zip-compressed"
                                  class="block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[12px] text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-[11px] file:font-medium file:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:file:bg-slate-800 dark:file:text-slate-200"
                                  onChange={(e) => {
                                    const file = e.currentTarget.files?.[0] ?? null
                                    setUploadSaveFile(file)
                                  }}
                                />
                                <Button
                                  variant="secondary"
                                  disabled={
                                    isReadOnly() ||
                                    !canStartInstance(status()) ||
                                    uploadSavePending() ||
                                    !uploadSaveFile()
                                  }
                                  loading={uploadSavePending()}
                                  onClick={async () => {
                                    const file = uploadSaveFile()
                                    if (!file) return
                                    try {
                                      setUploadSavePending(true)
                                      const csrf = await ensureCsrfCookie()
                                      const form = new FormData()
                                      form.set('instance_id', id())
                                      form.set('file', file, file.name || 'save.zip')

                                      const resp = await fetch('/instance/upload-save', {
                                        method: 'POST',
                                        credentials: 'include',
                                        headers: {
                                          'x-csrf-token': csrf,
                                        },
                                        body: form,
                                      })
                                      const payload = (await resp.json().catch(() => null)) as any
                                      if (!resp.ok) {
                                        throw new Error(payload?.message || t('instances.details.uploadFailed', { status: resp.status }))
                                      }
                                      pushToast(
                                        'success',
                                        t('instances.details.imported'),
                                        payload?.message || payload?.installed_path || t('instances.details.imported'),
                                        undefined,
                                        {
                                          context: instanceToastContext(),
                                        },
                                      )
                                      setUploadSaveFile(null)
                                      if (uploadSaveInputRef) uploadSaveInputRef.value = ''
                                    } catch (e) {
                                      toastError(t('instances.details.importFailed'), e, {
                                        context: instanceToastContext(),
                                      })
                                    } finally {
                                      setUploadSavePending(false)
                                    }
                                  }}
                                >
                                  {t('instances.details.uploadImport')}
                                </Button>
                              </div>
                            </div>
                          </Show>

                          <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                            {t('instances.details.saveStoppedHint')}
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Show>

                  <Show when={instanceDetailTab() === 'logs'}>
                    <Show when={!canTailProcessLogs()}>
                      <div class="mt-3 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
                        {t('instances.details.logsNotRunning')}
                      </div>
                    </Show>
                    <Show when={canTailProcessLogs() && processLogsTail.isError}>
                      <ErrorState t={t} error={processLogsTail.error} title={t('instances.details.loadLogsFailed')} onRetry={() => processLogsTail.refetch()} />
                    </Show>
                    <LogViewer
                      t={t}
                      title={t('instances.details.processLogs')}
                      lines={processLogLines()}
                      loading={canTailProcessLogs() ? processLogsTail.isPending : false}
                      error={canTailProcessLogs() && processLogsTail.isError ? processLogsTail.error : undefined}
                      live={processLogLive()}
                      onLiveChange={setProcessLogLive}
                      onClear={() => setProcessLogLines([])}
                      storageKey={`alloy.processlog.${id()}`}
                      class="mt-3"
                    />
                  </Show>

                  <Show when={instanceDetailTab() === 'files'}>
                    <div class="rounded-2xl border border-slate-200 bg-white/70 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
	                      <FileBrowser
	                        t={t}
	                        enabled={isAuthed() && showInstanceModal() && instanceDetailTab() === 'files'}
                        title={t('tab.files')}
	                        rootPath={`instances/${id()}`}
	                        rootLabel={uiName()}
	                      />
                    </div>
                  </Show>

                  <Show when={instanceDetailTab() === 'config'}>
                    <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('instances.details.parameters')}</div>
                        <div class="text-[11px] text-slate-500 dark:text-slate-400">
                          {t('instances.details.editsRequireStop')}
                        </div>
                      </div>

                      <div class="mt-3 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                        <div class="grid grid-cols-[160px_1fr_auto] gap-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                          <div>{t('instances.details.configKey')}</div>
                          <div>{t('instances.details.configValue')}</div>
                          <div class="text-right">{t('instances.details.configActions')}</div>
                        </div>
                        <div class="divide-y divide-slate-200 dark:divide-slate-800">
                          <For
                            each={Object.entries(params() ?? {}).sort(([a], [b]) => a.localeCompare(b))}
                          >
                            {([k, v]) => (
                              <div class="grid grid-cols-[160px_1fr_auto] gap-3 px-3 py-2 text-[12px] text-slate-700 dark:text-slate-200">
                                <div class="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400" title={k}>
                                  {k}
                                </div>
                                <div class="min-w-0 font-mono text-[11px]">
                                  <Show
                                    when={
                                      isSecretParamKey(k)
                                    }
                                    fallback={<span class="whitespace-pre-wrap break-words">{String(v ?? '')}</span>}
                                  >
                                    <Show
                                      when={revealedSecrets()[k]}
                                      fallback={<span class="text-slate-500 dark:text-slate-400">••••••</span>}
                                    >
                                      <span class="whitespace-pre-wrap break-words">{String(v ?? '')}</span>
                                    </Show>
                                  </Show>
                                </div>
                                <div class="flex items-center justify-end gap-2">
                                  <Show
                                    when={
                                      isSecretParamKey(k)
                                    }
                                  >
                                    <Button
                                      size="xs"
                                      variant="secondary"
                                      onClick={() => setRevealedSecrets((prev) => ({ ...prev, [k]: !(prev[k] ?? false) }))}
                                    >
                                      {revealedSecrets()[k] ? t('instances.details.hide') : t('instances.details.show')}
                                    </Button>
                                  </Show>
                                  <Button
                                    size="xs"
                                    variant="secondary"
                                    onClick={() => safeCopy(String(v ?? ''))}
                                    disabled={String(v ?? '').length === 0}
                                    title={t('instances.details.copyValue')}
                                  >
                                    {t('instances.details.copy')}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    </div>
                  </Show>
                </div>
              )
            }}
          </Show>
        </Modal>
  )
}
