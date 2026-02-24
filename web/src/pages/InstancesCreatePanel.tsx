import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import { buildCreateDraft } from '../app/helpers/instanceCreateValidation'
import { safeCopy } from '../app/helpers/misc'
import { templateDisplayLabel, templateLogoSrc } from '../app/helpers/templateBrand'
import type { I18nTranslate } from '../app/i18n'
import { isAlloyApiError } from '../rspc'
import { Dropdown } from '../components/Dropdown'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Field } from '../components/ui/Field'
import { GameAvatar } from '../components/ui/GameAvatar'
import { IconButton } from '../components/ui/IconButton'
import { Input } from '../components/ui/Input'
import { Tooltip } from '../components/ui/Tooltip'
import MinecraftCreateSection from './instances-create/MinecraftCreateSection'
import DstCreateSection from './instances-create/DstCreateSection'
import TerrariaCreateSection from './instances-create/TerrariaCreateSection'
import PalworldCreateSection from './instances-create/PalworldCreateSection'
import FactorioCreateSection from './instances-create/FactorioCreateSection'

export type InstancesCreatePanelProps = {
  t: I18nTranslate
  [key: string]: unknown
}

type CreateStep = 1 | 2 | 3

export default function InstancesCreatePanel(props: InstancesCreatePanelProps) {
  const {
    createFieldErrors,
    createFormError,
    createInstance,
    createNodeDropdownOptions,
    createSelectedNode,
    createNodeId,
    createPreview,
    createTemplateId,
    dstAuthPort,
    dstClusterName,
    dstClusterToken,
    dstMasterPort,
    dstMaxPlayers,
    dstPassword,
    dstPort,
    focusFirstCreateError,
    friendlyErrorMessage,
    instanceName,
    invalidateInstances,
    isReadOnly,
    mcEffectiveFrpConfig,
    mcEula,
    mcFrpEnabled,
    mcFrpMode,
    mcImportPack,
    mcMemory,
    mcPort,
    mcVersion,
    pushToast,
    revealInstance,
    selectedTemplate,
    setCreateFieldErrors,
    setCreateFormError,
    setCreateInstanceNameEl,
    setCreateInstanceNameRef,
    setFocusCreateEntry,
    setCreateNodeId,
    setCreateNodeSelectEl,
    setCreateSleepSecondsEl,
    setInstanceName,
    setSelectedInstanceId,
    setSelectedTemplate,
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
    t,
  } = props as any

  const translate: I18nTranslate = t

  const [createStep, setCreateStep] = createSignal<CreateStep>(1)
  let createNameInputEl: HTMLInputElement | undefined

  createEffect(() => {
    if (typeof setFocusCreateEntry !== 'function') return
    setFocusCreateEntry(() => {
      setCreateStep(1)
      queueMicrotask(() => {
        const el = createNameInputEl
        if (!el) return
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } catch {}
        el.focus()
        el.select()
      })
    })
  })

  const fieldLabelForError = (key: string): string | null => {
    if (key === 'node_id') return translate('instancesCreate.errorField.node')
    if (key === 'accept_eula') return translate('instancesCreate.errorField.eula')
    if (key === 'frp_config') return translate('instancesCreate.errorField.tunnel')
    if (key === 'pack') return translate('instancesCreate.errorField.pack')
    if (key === 'seconds') return translate('instancesCreate.errorField.seconds')
    if (key === 'rcon_password') return translate('instancesCreate.errorField.rconPassword')
    return null
  }

  const errorSummaryItems = createMemo(() => {
    const errors = (createFieldErrors?.() ?? {}) as Record<string, string>
    const out: Array<{ key: string; message: string; label: string | null }> = []
    for (const [key, message] of Object.entries(errors)) {
      const m = String(message ?? '').trim()
      if (!m) continue
      out.push({ key, message: m, label: fieldLabelForError(key) })
    }
    return out
  })

  const buildDraft = () =>
    buildCreateDraft({
      t: translate,
      templateId: createTemplateId(),
      instanceName: instanceName(),
      nodeId: createNodeId(),
      selectedNodeId: createSelectedNode?.()?.id ?? null,
      selectedNodeLastSeenAt: createSelectedNode?.()?.last_seen_at ?? null,
      sleepSeconds: sleepSeconds(),
      mcEula: mcEula(),
      mcFrpEnabled: mcFrpEnabled(),
      mcFrpMode: mcFrpMode() as 'paste' | 'node',
      mcEffectiveFrpConfig: mcEffectiveFrpConfig(),
      mcVersion: mcVersion(),
      mcMemory: mcMemory(),
      mcPort: mcPort(),
      mcImportPack: mcImportPack(),
      trVersion: trVersion(),
      trPort: trPort(),
      trMaxPlayers: trMaxPlayers(),
      trWorldName: trWorldName(),
      trWorldSize: trWorldSize(),
      trPassword: trPassword(),
      trFrpEnabled: trFrpEnabled(),
      trFrpMode: trFrpMode() as 'paste' | 'node',
      trEffectiveFrpConfig: trEffectiveFrpConfig(),
      dstClusterToken: dstClusterToken(),
      dstClusterName: dstClusterName(),
      dstMaxPlayers: dstMaxPlayers(),
      dstPassword: dstPassword(),
      dstPort: dstPort(),
      dstMasterPort: dstMasterPort(),
      dstAuthPort: dstAuthPort(),
      pwServerName: (props as any).pwServerName(),
      pwServerDescription: (props as any).pwServerDescription(),
      pwMaxPlayers: (props as any).pwMaxPlayers(),
      pwPassword: (props as any).pwPassword(),
      pwAdminPassword: (props as any).pwAdminPassword(),
      pwPublic: Boolean((props as any).pwPublic()),
      pwPort: (props as any).pwPort(),
      pwQueryPort: (props as any).pwQueryPort(),
      fxVersion: (props as any).fxVersion(),
      fxServerName: (props as any).fxServerName(),
      fxServerDescription: (props as any).fxServerDescription(),
      fxMaxPlayers: (props as any).fxMaxPlayers(),
      fxPublic: Boolean((props as any).fxPublic()),
      fxPort: (props as any).fxPort(),
      fxRconEnabled: Boolean((props as any).fxRconEnabled()),
      fxRconPort: (props as any).fxRconPort(),
      fxRconPassword: (props as any).fxRconPassword(),
    })

  createEffect(() => {
    selectedTemplate()
    setCreateStep(1)
    setCreateFieldErrors({})
    setCreateFormError(null)
  })

  const noTemplateHint = translate('instancesCreate.noTemplatesHint')
  const noNodesHint = translate('instancesCreate.noNodesHint')

  const stepLabel = (step: CreateStep) => {
    if (step === 1) return translate('createWizard.stepTemplate')
    if (step === 2) return translate('createWizard.stepRuntime')
    return translate('createWizard.stepPreview')
  }

  return (
    <div class="space-y-3" aria-label={translate('instancesCreate.ariaLabel')}>
      <div class="rounded-xl border border-slate-200 bg-white/60 p-2 dark:border-slate-800 dark:bg-slate-950/40">
        <ol class="grid grid-cols-3 gap-2">
          <For each={[1, 2, 3] as const}>
            {(step) => {
              const isCurrent = () => createStep() === step
              const canOpen = () => step <= createStep()
              return (
                <li>
                  <button
                    type="button"
                    disabled={!canOpen()}
                    class={`w-full rounded-lg border px-2 py-2 text-left transition ${
                      isCurrent()
                        ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/25 dark:text-amber-200'
                        : canOpen()
                          ? 'border-slate-200 bg-white/80 text-slate-700 hover:border-amber-200 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-amber-700/50 dark:hover:text-slate-100'
                          : 'cursor-not-allowed border-slate-200/70 bg-slate-50/70 text-slate-400 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-500'
                    }`}
                    onClick={() => {
                      if (canOpen()) setCreateStep(step)
                    }}
                  >
                    <div class="flex items-center gap-2">
                      <span
                        class={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                          isCurrent()
                            ? 'bg-amber-600 text-white dark:bg-amber-500 dark:text-slate-950'
                            : canOpen()
                              ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                              : 'bg-slate-200/70 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
                        }`}
                        aria-hidden="true"
                      >
                        {step}
                      </span>
                      <span class="truncate text-xs font-medium" aria-current={isCurrent() ? 'step' : undefined}>
                        {stepLabel(step)}
                      </span>
                    </div>
                  </button>
                </li>
              )
            }}
          </For>
        </ol>
      </div>

      <Show when={createStep() === 1}>
        <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {translate('createWizard.stepTemplate')}
        </div>
        <Field label={translate('instancesCreate.nameLabel')}>
          <Input
            ref={(el) => {
              createNameInputEl = el
              setCreateInstanceNameRef?.(el)
              setCreateInstanceNameEl?.(el)
            }}
            value={instanceName()}
            onInput={(e) => setInstanceName(e.currentTarget.value)}
            placeholder={translate('instancesCreate.namePlaceholder')}
            spellcheck={false}
          />
        </Field>

        <Field label={translate('instancesCreate.templateLabel')} required>
          <Dropdown
            label=""
            value={selectedTemplate()}
            options={templateOptions()}
            disabled={templates.isPending || templateOptions().length === 0}
            placeholder={templates.isPending ? translate('instancesCreate.templatesLoading') : translate('instancesCreate.templatesEmpty')}
            title={!templates.isPending && templateOptions().length === 0 ? noTemplateHint : undefined}
            onChange={setSelectedTemplate}
          />
        </Field>

        <Button
          class="w-full"
          size="md"
          variant="primary"
          disabled={templates.isPending || templateOptions().length === 0}
          onClick={() => setCreateStep(2)}
        >
          {translate('createWizard.next')}
        </Button>
      </Show>

      <Show when={createStep() === 2}>
        <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {translate('createWizard.stepRuntime')}
        </div>
        <Field label={translate('instancesCreate.nodeLabel')} error={createFieldErrors().node_id}>
          <div ref={(el) => setCreateNodeSelectEl?.(el)}>
            <Dropdown
              label=""
              value={createNodeId()}
              options={createNodeDropdownOptions()}
              disabled={createNodeDropdownOptions().length === 0}
              placeholder={
                createNodeDropdownOptions().length === 0
                  ? translate('instancesCreate.nodesEmpty')
                  : translate('instancesCreate.nodeSelectPlaceholder')
              }
              title={createNodeDropdownOptions().length === 0 ? noNodesHint : undefined}
              onChange={(value) => {
                setCreateNodeId(value)
                if (createFieldErrors().node_id) {
                  setCreateFieldErrors((prev: Record<string, string>) => {
                    const next = { ...prev }
                    delete next.node_id
                    return next
                  })
                }
              }}
            />
          </div>
        </Field>

        <Show when={selectedTemplate() === 'demo:sleep'}>
          <Field label={translate('instancesCreate.sleepSecondsLabel')} required error={createFieldErrors().seconds}>
            <Input
              ref={(el) => {
                setCreateSleepSecondsEl?.(el)
              }}
              type="number"
              value={sleepSeconds()}
              onInput={(e) => setSleepSeconds(e.currentTarget.value)}
              invalid={Boolean(createFieldErrors().seconds)}
              placeholder={translate('instancesCreate.sleepSecondsPlaceholder')}
            />
          </Field>
        </Show>

        <MinecraftCreateSection {...(props as any)} />

        <DstCreateSection {...(props as any)} />

        <TerrariaCreateSection {...(props as any)} />

        <PalworldCreateSection {...(props as any)} />

        <FactorioCreateSection {...(props as any)} />

        <div class="grid grid-cols-2 gap-2">
          <Button class="w-full" size="md" variant="secondary" onClick={() => setCreateStep(1)}>
            {translate('createWizard.back')}
          </Button>
          <Button
            class="w-full"
            size="md"
            variant="primary"
            onClick={() => {
              setCreateFieldErrors({})
              const draft = buildDraft()
              if (Object.keys(draft.errors).length > 0) {
                setCreateFieldErrors(draft.errors)
                queueMicrotask(() => focusFirstCreateError(draft.errors))
                return
              }
              setCreateStep(3)
            }}
          >
            {translate('createWizard.review')}
          </Button>
        </div>
      </Show>

      <Show when={createStep() === 3}>
        <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {translate('createWizard.stepPreview')}
        </div>
        <div class="rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          <div class="flex items-center justify-between gap-3">
            <div class="text-section-title">{translate('instancesCreate.previewTitle')}</div>
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
              <GameAvatar
                name={templateDisplayLabel(createPreview().template_id)}
                src={templateLogoSrc(createPreview().template_id)}
                class="h-8 w-8 rounded-lg"
                title={templateDisplayLabel(createPreview().template_id)}
              />
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

        <Button class="w-full" size="md" variant="secondary" onClick={() => setCreateStep(2)}>
          {translate('createWizard.back')}
        </Button>

        <Show when={errorSummaryItems().length > 0}>
          <div class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
            <div class="font-semibold">{translate('instancesCreate.errorSummaryTitle')}</div>
            <div class="mt-1 space-y-1">
              <For each={errorSummaryItems()}>
                {(item) => (
                  <button
                    type="button"
                    class="block w-full rounded-md px-2 py-1 text-left text-xs text-rose-800/90 hover:bg-rose-100 dark:text-rose-200/90 dark:hover:bg-rose-900/30"
                    onClick={() => {
                      setCreateStep(2)
                      queueMicrotask(() => focusFirstCreateError({ [item.key]: item.message }))
                    }}
                  >
                    <span class="font-semibold">{item.label ? `${item.label}: ` : ''}</span>
                    <span>{item.message}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

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
            title={isReadOnly() ? translate('common.readOnlyMode') : translate('instancesCreate.createTitle')}
            onClick={async () => {
              setCreateFormError(null)
              setCreateFieldErrors({})

              const draft = buildDraft()

              if (Object.keys(draft.errors).length > 0) {
                setCreateFieldErrors(draft.errors)
                setCreateStep(2)
                queueMicrotask(() => focusFirstCreateError(draft.errors))
                return
              }

              try {
                const out = await createInstance.mutateAsync({
                  template_id: draft.template_id,
                  params: draft.params,
                  display_name: draft.display_name,
                  node_id: draft.node_id,
                })
                pushToast('success', translate('instancesCreate.toastCreatedTitle'), draft.display_name ?? undefined)
                await invalidateInstances()
                revealInstance(out.instance_id)
                setSelectedInstanceId(out.instance_id)
              } catch (e) {
                if (isAlloyApiError(e)) {
                  const fieldErrors = { ...(e.data.field_errors ?? {}) } as Record<string, string>

                  if (e.data.code === 'agent_unreachable' && !fieldErrors.node_id) {
                    fieldErrors.node_id = translate('instancesCreate.errors.nodeOffline')
                  }

                  setCreateFieldErrors(fieldErrors)
                  setCreateFormError({ message: e.data.message, requestId: e.data.request_id })
                  if (e.data.hint) pushToast('info', translate('common.hint'), e.data.hint, e.data.request_id)
                  if (Object.keys(fieldErrors).length > 0) setCreateStep(2)
                  queueMicrotask(() => focusFirstCreateError(fieldErrors))
                } else {
                  setCreateFormError({ message: friendlyErrorMessage(e) })
                }
              }
            }}
          >
            {translate('instancesCreate.createCta')}
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
              ![
                'minecraft:vanilla',
                'terraria:vanilla',
                'palworld:vanilla',
                'factorio:vanilla',
                'core_keeper:vanilla',
                'seven_days:vanilla',
                'the_forest:vanilla',
                'sons_of_the_forest:vanilla',
              ].includes(createTemplateId())
            }
            title={isReadOnly() ? translate('common.readOnlyMode') : translate('instancesCreate.warmTitle')}
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
              if (template_id === 'factorio:vanilla') {
                const v = (props as any).fxVersion().trim()
                params.version = v || 'stable'
              }

              try {
                const out = await warmCache.mutateAsync({ template_id, params })
                pushToast('success', translate('instancesCreate.toastWarmTitle'), out.message)
              } catch (e) {
                toastError(translate('instancesCreate.toastWarmFailedTitle'), e)
              }
            }}
          >
            {translate('instancesCreate.warmCta')}
          </Button>
        </div>

        <Show when={warmCache.isPending}>
          <div class="mt-2 rounded-xl border border-slate-200 bg-white/60 px-3 py-2 text-[12px] text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
            {translate('instancesCreate.warmPendingHint')}
          </div>
        </Show>

        <Show when={createFormError()}>
          <div class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
            <div class="font-semibold">{translate('instancesCreate.createFailedTitle')}</div>
            <div class="mt-1 whitespace-pre-wrap break-words text-xs text-rose-800/90 dark:text-rose-200/90">{createFormError()!.message}</div>
            <Show when={createFormError()!.requestId}>
              <div class="mt-2 flex items-center justify-between gap-2">
                <div class="min-w-0 truncate whitespace-nowrap font-mono text-[11px] text-rose-700/80 dark:text-rose-200/70">
                  {translate('common.requestId')} {createFormError()!.requestId}
                </div>
                <IconButton size="sm" variant="danger" class="h-6 w-6 shrink-0" label={translate('instancesCreate.copyRequestId')} onClick={() => void safeCopy(createFormError()!.requestId ?? '')}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                    <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                    <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                  </svg>
                </IconButton>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  )
}
