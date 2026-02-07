import { For, Show } from 'solid-js'
import { safeCopy } from '../app/helpers/misc'
import { isAlloyApiError } from '../rspc'
import { Dropdown } from '../components/Dropdown'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Field } from '../components/ui/Field'
import { IconButton } from '../components/ui/IconButton'
import { Input } from '../components/ui/Input'
import { TemplateMark } from '../components/ui/TemplateMark'
import { Tooltip } from '../components/ui/Tooltip'
import MinecraftCreateSection from './instances-create/MinecraftCreateSection'
import DstCreateSection from './instances-create/DstCreateSection'
import TerrariaCreateSection from './instances-create/TerrariaCreateSection'
import DspCreateSection from './instances-create/DspCreateSection'

export type InstancesCreatePanelProps = {
  [key: string]: unknown
}

export default function InstancesCreatePanel(props: InstancesCreatePanelProps) {
  const {
    createFieldErrors,
    createFormError,
    createInstance,
    createPreview,
    createTemplateId,
    dspAutoPauseEnabled,
    dspPort,
    dspRemoteAccessPassword,
    dspSaveName,
    dspServerPassword,
    dspSourceInitRequired,
    dspStartupMode,
    dspSteamGuardCode,
    dspSteamcmdSettingsRequiredMessage,
    dspUps,
    dspWarmNeedsInit,
    dspWineBin,
    dstAuthPort,
    dstClusterName,
    dstClusterToken,
    dstMasterPort,
    dstMaxPlayers,
    dstPassword,
    dstPort,
    focusFirstCreateError,
    friendlyErrorMessage,
    hasSavedSteamcmdCreds,
    instanceName,
    invalidateInstances,
    isReadOnly,
    mcCurseforge,
    mcEffectiveFrpConfig,
    mcEula,
    mcFrpEnabled,
    mcFrpMode,
    mcImportPack,
    mcMemory,
    mcMrpack,
    mcPort,
    mcVersion,
    pushToast,
    revealInstance,
    runDspInitAndMaybeCreate,
    selectedTemplate,
    setCreateFieldErrors,
    setCreateFormError,
    setCreateInstanceNameEl,
    setCreateInstanceNameRef,
    setCreateSleepSecondsEl,
    setDspSteamGuardCode,
    setDspWarmNeedsInit,
    setInstanceName,
    setPendingCreateAfterDspInit,
    setSelectedInstanceId,
    setSelectedTemplate,
    setShowDspInitModal,
    setSleepSeconds,
    setWarmFieldErrors,
    setWarmFormError,
    sleepSeconds,
    templateOptions,
    templates,
    toastError,
    trEffectiveFrpConfig,
    trFrpEnabled,
    trFrpMode,
    trMaxPlayers,
    trPassword,
    trPort,
    trVersion,
    trWorldName,
    trWorldSize,
    warmCache,
  } = props as any

  return (
                    <div class="space-y-3">
	                      <Field
	                        label="Name (optional)"
	                      >
                        <Input
                          ref={(el) => {
                            setCreateInstanceNameRef?.(el)
                            setCreateInstanceNameEl?.(el)
                          }}
                          value={instanceName()}
                          onInput={(e) => setInstanceName(e.currentTarget.value)}
                          placeholder="e.g. survival-1"
                          spellcheck={false}
                        />
                      </Field>

                      <Field label="Template" required>
                        <Dropdown
                          label=""
                          value={selectedTemplate()}
                          options={templateOptions()}
                          disabled={templates.isPending || templateOptions().length === 0}
                          placeholder={templates.isPending ? 'Loading templates...' : 'No templates'}
                          onChange={setSelectedTemplate}
                        />
                      </Field>

	                      <Show when={selectedTemplate() === 'demo:sleep'}>
	                        <Field
	                          label="Seconds"
	                          required
	                          error={createFieldErrors().seconds}
	                        >
                          <Input
                            ref={(el) => {
                              setCreateSleepSecondsEl?.(el)
                            }}
                            type="number"
                            value={sleepSeconds()}
                            onInput={(e) => setSleepSeconds(e.currentTarget.value)}
                            invalid={Boolean(createFieldErrors().seconds)}
                          />
                        </Field>
                      </Show>

                      <MinecraftCreateSection {...(props as any)} />







                      <DstCreateSection {...(props as any)} />

                      <TerrariaCreateSection {...(props as any)} />

                      <DspCreateSection {...(props as any)} />

                      <div class="rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                        <div class="flex items-center justify-between gap-3">
                          <div class="text-section-title">Preview</div>
                          <div class="flex min-w-0 items-center justify-end gap-2">
                            <Show when={createPreview().warnings.length > 0}>
                              <Tooltip
                                content={
                                  <div class="space-y-1">
                                    <For each={createPreview().warnings}>{(w) => <div class="whitespace-pre-wrap">{w}</div>}</For>
                                  </div>
                                }
                              >
                                <Badge variant="warning" class="cursor-help">
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-3 w-3">
                                    <path
                                      fill-rule="evenodd"
                                      d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.515 2.625H3.72c-1.345 0-2.188-1.458-1.515-2.625l6.28-10.875zM10 6.75a.75.75 0 00-.75.75v3.5a.75.75 0 001.5 0v-3.5A.75.75 0 0010 6.75zm0 7a.75.75 0 100-1.5.75.75 0 000 1.5z"
                                      clip-rule="evenodd"
                                    />
                                  </svg>
                                  {createPreview().warnings.length}
                                </Badge>
                              </Tooltip>
                            </Show>
                            <TemplateMark templateId={createPreview().template_id} class="h-8 w-8" />
                          </div>
                        </div>
                        <div class="mt-2 space-y-1.5">
                          <For each={createPreview().rows}>
                            {(row) => (
                              <div class="flex items-start justify-between gap-4 text-[12px]">
                                <div class="text-slate-500 dark:text-slate-400">{row.label}</div>
                                <div
                                  class={`min-w-0 truncate font-mono text-[11px] ${
                                    row.isSecret ? 'text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-200'
                                  }`}
                                  title={row.value}
                                >
                                  {row.value}
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>

                      <div class="grid grid-cols-2 gap-2">
	                        <Button
	                          class="w-full"
	                          size="md"
	                          variant="primary"
	                          leftIcon={
	                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                              <path
	                                fill-rule="evenodd"
	                                d="M10 4.25a.75.75 0 01.75.75v4.25H15a.75.75 0 010 1.5h-4.25V15a.75.75 0 01-1.5 0v-4.25H5a.75.75 0 010-1.5h4.25V5a.75.75 0 01.75-.75z"
	                                clip-rule="evenodd"
	                              />
	                            </svg>
	                          }
	                          loading={createInstance.isPending}
	                          disabled={isReadOnly()}
	                          title={isReadOnly() ? 'Read-only mode' : 'Create instance'}
	                          onClick={async () => {
	                            const template_id = createTemplateId()
	                            const params: Record<string, string> = {}
	                            const display_name = instanceName().trim() ? instanceName().trim() : null

                            setCreateFormError(null)
                            setCreateFieldErrors({})

                            const localErrors: Record<string, string> = {}
                            const mcFrpCfg = mcEffectiveFrpConfig().trim()
                            const trFrpCfg = trEffectiveFrpConfig().trim()

                            if (template_id === 'demo:sleep') {
                              params.seconds = sleepSeconds()
                            } else if (template_id === 'minecraft:vanilla') {
                              if (!mcEula()) localErrors.accept_eula = 'You must accept the EULA to start a Minecraft server.'
                              if (mcFrpEnabled() && !mcFrpCfg)
                                localErrors.frp_config = mcFrpMode() === 'node' ? 'Select an FRP node.' : 'Paste FRP config.'
                              params.accept_eula = 'true'
                              const v = mcVersion().trim()
                              params.version = v || 'latest_release'
                              params.memory_mb = mcMemory() || '2048'
                              if (mcPort().trim()) params.port = mcPort().trim()
                              if (mcFrpEnabled() && mcFrpCfg) params.frp_config = mcFrpCfg
                            } else if (template_id === 'minecraft:modrinth') {
                              if (!mcEula()) localErrors.accept_eula = 'You must accept the EULA to start a Minecraft server.'
                              if (!mcMrpack().trim()) localErrors.mrpack = 'Paste a Modrinth version link or a direct .mrpack URL.'
                              if (mcFrpEnabled() && !mcFrpCfg)
                                localErrors.frp_config = mcFrpMode() === 'node' ? 'Select an FRP node.' : 'Paste FRP config.'
                              params.accept_eula = 'true'
                              params.mrpack = mcMrpack().trim()
                              params.memory_mb = mcMemory() || '2048'
                              if (mcPort().trim()) params.port = mcPort().trim()
                              if (mcFrpEnabled() && mcFrpCfg) params.frp_config = mcFrpCfg
                            } else if (template_id === 'minecraft:import') {
                              if (!mcEula()) localErrors.accept_eula = 'You must accept the EULA to start a Minecraft server.'
                              if (!mcImportPack().trim()) localErrors.pack = 'Provide a server pack zip URL, or a path under /data.'
                              if (mcFrpEnabled() && !mcFrpCfg)
                                localErrors.frp_config = mcFrpMode() === 'node' ? 'Select an FRP node.' : 'Paste FRP config.'
                              params.accept_eula = 'true'
                              params.pack = mcImportPack().trim()
                              params.memory_mb = mcMemory() || '2048'
                              if (mcPort().trim()) params.port = mcPort().trim()
                              if (mcFrpEnabled() && mcFrpCfg) params.frp_config = mcFrpCfg
                            } else if (template_id === 'minecraft:curseforge') {
                              if (!mcEula()) localErrors.accept_eula = 'You must accept the EULA to start a Minecraft server.'
                              if (!mcCurseforge().trim()) localErrors.curseforge = 'Paste a CurseForge file URL, or modId:fileId.'
                              if (mcFrpEnabled() && !mcFrpCfg)
                                localErrors.frp_config = mcFrpMode() === 'node' ? 'Select an FRP node.' : 'Paste FRP config.'
                              params.accept_eula = 'true'
                              params.curseforge = mcCurseforge().trim()
                              params.memory_mb = mcMemory() || '2048'
                              if (mcPort().trim()) params.port = mcPort().trim()
                              if (mcFrpEnabled() && mcFrpCfg) params.frp_config = mcFrpCfg
                            } else if (template_id === 'terraria:vanilla') {
                              const v = trVersion().trim()
                              params.version = v || '1453'
                              if (trPort().trim()) params.port = trPort().trim()
                              params.max_players = trMaxPlayers().trim() || '8'
                              params.world_name = trWorldName().trim() || 'world'
                              params.world_size = trWorldSize().trim() || '1'
                              if (trPassword().trim()) params.password = trPassword().trim()
                              if (trFrpEnabled() && !trFrpCfg)
                                localErrors.frp_config = trFrpMode() === 'node' ? 'Select an FRP node.' : 'Paste FRP config.'
                              if (trFrpEnabled() && trFrpCfg) params.frp_config = trFrpCfg
                            } else if (template_id === 'dst:vanilla') {
                              params.cluster_token = dstClusterToken().trim()
                              params.cluster_name = dstClusterName().trim() || 'Alloy DST server'
                              params.max_players = dstMaxPlayers().trim() || '6'
                              if (dstPassword().trim()) params.password = dstPassword().trim()
                              const p = dstPort().trim()
                              const mp = dstMasterPort().trim()
                              const ap = dstAuthPort().trim()
                              if (p) params.port = p
                              if (mp) params.master_port = mp
                              if (ap) params.auth_port = ap
                            } else if (template_id === 'dsp:nebula') {
                              const mode = dspStartupMode().trim() || 'auto'
                              const save = dspSaveName().trim()
                              if (mode === 'load' && !save) localErrors.save_name = 'Required when startup_mode=load.'
                              params.startup_mode = mode
                              if (save) params.save_name = save
                              if (dspPort().trim()) params.port = dspPort().trim()
                              if (dspServerPassword().trim()) params.server_password = dspServerPassword().trim()
                              if (dspRemoteAccessPassword().trim()) params.remote_access_password = dspRemoteAccessPassword().trim()
                              params.auto_pause_enabled = dspAutoPauseEnabled() ? 'true' : 'false'
                              params.ups = dspUps().trim() || '60'
                              params.wine_bin = dspWineBin().trim() || 'wine64'
                            }

                            if (Object.keys(localErrors).length > 0) {
                              setCreateFieldErrors(localErrors)
                              queueMicrotask(() => focusFirstCreateError(localErrors))
                              return
                            }

                            if (template_id === 'dsp:nebula' && dspWarmNeedsInit()) {
                              if (!hasSavedSteamcmdCreds()) {
                                setPendingCreateAfterDspInit(null)
                                setCreateFieldErrors({})
                                setCreateFormError({ message: dspSteamcmdSettingsRequiredMessage() })
                                pushToast('error', 'SteamCMD not configured', dspSteamcmdSettingsRequiredMessage())
                                return
                              }
                              setPendingCreateAfterDspInit({ template_id, params: { ...params }, display_name })
                              await runDspInitAndMaybeCreate()
                              return
                            }

                            try {
                              const out = await createInstance.mutateAsync({ template_id, params, display_name })
                              pushToast('success', 'Instance created', display_name ?? undefined)
                              await invalidateInstances()
                              revealInstance(out.instance_id)
                              setSelectedInstanceId(out.instance_id)
                            } catch (e) {
                              if (isAlloyApiError(e)) {
                                const fieldErrors = e.data.field_errors ?? {}
                                if (template_id === 'dsp:nebula' && dspSourceInitRequired(e.data.message, fieldErrors)) {
                                  setDspWarmNeedsInit(true)
                                  setCreateFieldErrors({})
                                  setCreateFormError(null)
                                  setWarmFieldErrors(fieldErrors)
                                  setWarmFormError({ message: e.data.message, requestId: e.data.request_id })

                                  if (!hasSavedSteamcmdCreds()) {
                                    setPendingCreateAfterDspInit(null)
                                    setWarmFieldErrors({})
                                    setWarmFormError(null)
                                    setCreateFormError({ message: dspSteamcmdSettingsRequiredMessage(), requestId: e.data.request_id })
                                    pushToast('error', 'SteamCMD not configured', dspSteamcmdSettingsRequiredMessage(), e.data.request_id)
                                  } else {
                                    setPendingCreateAfterDspInit({ template_id, params: { ...params }, display_name })
                                    await runDspInitAndMaybeCreate()
                                  }
                                  if (e.data.hint) pushToast('info', 'Hint', e.data.hint, e.data.request_id)
                                  return
                                }

                                setCreateFieldErrors(fieldErrors)
                                setCreateFormError({ message: e.data.message, requestId: e.data.request_id })
                                if (e.data.hint) pushToast('info', 'Hint', e.data.hint, e.data.request_id)
                                queueMicrotask(() => focusFirstCreateError(fieldErrors))
                              } else {
                                setCreateFormError({ message: friendlyErrorMessage(e) })
                              }
                            }
                          }}
                        >
                          Create
                        </Button>

	                        <Button
	                          class="w-full"
	                          size="md"
	                          variant="secondary"
	                          leftIcon={
	                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                              <path
	                                fill-rule="evenodd"
	                                d="M10 2.75a.75.75 0 01.75.75v6.69l2.22-2.22a.75.75 0 111.06 1.06l-3.5 3.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06l2.22 2.22V3.5a.75.75 0 01.75-.75zM3.5 13.25a.75.75 0 01.75.75v1.25c0 .69.56 1.25 1.25 1.25h9c.69 0 1.25-.56 1.25-1.25V14a.75.75 0 011.5 0v1.25A2.75 2.75 0 0114.5 18h-9a2.75 2.75 0 01-2.75-2.75V14a.75.75 0 01.75-.75z"
	                                clip-rule="evenodd"
	                              />
	                            </svg>
	                          }
	                          loading={warmCache.isPending}
                          disabled={
                            isReadOnly() ||
                            createInstance.isPending ||
                            !['minecraft:vanilla', 'terraria:vanilla', 'dsp:nebula'].includes(createTemplateId())
                          }
                          title={isReadOnly() ? 'Read-only mode' : 'Only download required files (no start)'}
	                          onClick={async () => {
	                            const template_id = createTemplateId()
	                            const params: Record<string, string> = {}
                            setWarmFormError(null)
                            setWarmFieldErrors({})
	                            if (template_id === 'minecraft:vanilla') {
	                              const v = mcVersion().trim()
	                              params.version = v || 'latest_release'
                            }
                            if (template_id === 'terraria:vanilla') {
                              const v = trVersion().trim()
                              params.version = v || '1453'
                            }
                            if (template_id === 'dsp:nebula') {
                              const guardCode = dspSteamGuardCode().trim()

                              if (dspWarmNeedsInit() && !hasSavedSteamcmdCreds()) {
                                setWarmFieldErrors({})
                                setWarmFormError(null)
                                pushToast('error', 'SteamCMD not configured', dspSteamcmdSettingsRequiredMessage())
                                return
                              }

                              if (guardCode) params.steam_guard_code = guardCode
                            }
                            try {
                              const out = await warmCache.mutateAsync({ template_id, params })
                              if (template_id === 'dsp:nebula') {
                                setDspWarmNeedsInit(false)
                                setWarmFieldErrors({})
                                setDspSteamGuardCode('')
                              }
                              pushToast('success', 'Cache warmed', out.message)
                            } catch (e) {
                              if (template_id === 'dsp:nebula' && isAlloyApiError(e)) {
                                const fieldErrors = e.data.field_errors ?? {}
                                const needsGuard = Boolean(fieldErrors.steam_guard_code)

                                if (needsGuard) {
                                  setWarmFieldErrors({ steam_guard_code: fieldErrors.steam_guard_code })
                                  setWarmFormError({ message: e.data.message, requestId: e.data.request_id })
                                  setShowDspInitModal(true)
                                } else {
                                  setWarmFieldErrors({})
                                  setWarmFormError(null)
                                  setShowDspInitModal(false)
                                  if (dspSourceInitRequired(e.data.message, fieldErrors) || fieldErrors.steam_username || fieldErrors.steam_password) {
                                    setDspWarmNeedsInit(true)
                                    pushToast('error', 'SteamCMD not configured', dspSteamcmdSettingsRequiredMessage(), e.data.request_id)
                                  }
                                }
                                if (e.data.hint) pushToast('info', 'Hint', e.data.hint, e.data.request_id)
                                return
                              }
                              toastError('Warm cache failed', e)
                            }
                          }}
                        >
                          Warm
                        </Button>
                      </div>
                      <Show when={warmCache.isPending}>
                        <div class="mt-2 rounded-xl border border-slate-200 bg-white/60 px-3 py-2 text-[12px] text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
                          Downloading and preparing server files… This can take a while.
                        </div>
                      </Show>
                      <Show when={createFormError()}>
                        <div class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                          <div class="font-semibold">Create failed</div>
                          <div class="mt-1 whitespace-pre-wrap break-words text-xs text-rose-800/90 dark:text-rose-200/90">{createFormError()!.message}</div>
		                          <Show when={createFormError()!.requestId}>
		                            <div class="mt-2 flex items-center justify-between gap-2">
		                              <div class="text-[11px] text-rose-700/80 dark:text-rose-200/70 font-mono">req {createFormError()!.requestId}</div>
		                              <IconButton
		                                size="sm"
		                                variant="danger"
		                                label="Copy request id"
		                                onClick={() => void safeCopy(createFormError()!.requestId ?? '')}
		                              >
		                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
		                                  <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
		                                  <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
		                                </svg>
		                              </IconButton>
		                            </div>
		                          </Show>
	                        </div>
	                      </Show>
                    </div>
  )
}
