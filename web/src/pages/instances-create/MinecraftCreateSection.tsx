import { Show } from 'solid-js'
import { optionsWithCurrentValue } from '../../app/helpers/misc'
import { CREATE_TEMPLATE_MINECRAFT, MINECRAFT_MODE_BY_TEMPLATE_ID } from '../../app/types'
import { LabelTip } from '../../app/primitives/LabelTip'
import { Button } from '../../components/ui/Button'
import { Dropdown } from '../../components/Dropdown'
import { Field } from '../../components/ui/Field'
import { Input } from '../../components/ui/Input'
import { Link } from '../../components/ui/Link'
import { Tabs } from '../../components/ui/Tabs'
import { Textarea } from '../../components/ui/Textarea'

export type MinecraftCreateSectionProps = {
  [key: string]: unknown
}

export default function MinecraftCreateSection(props: MinecraftCreateSectionProps) {
  const {
    t,
    selectedTemplate,
    createFieldErrors,
    createTemplateId,
    mcCreateMode,
    minecraftCreateModeOptions,
    setSelectedTemplate,
    setMcCreateMode,
    createAdvanced,
    setCreateAdvanced,
    createAdvancedDirty,
    setCreateMcEulaEl,
    mcEula,
    setMcEula,
    setCreateMcImportPackEl,
    mcImportPack,
    mcImportPackOptions,
    mcImportPacksPending,
    mcImportUploadPending,
    setMcImportPack,
    uploadMcImportPackFile,
    setTab,
    mcVersion,
    mcVersionOptions,
    setMcVersion,
    setCreateMcMemoryEl,
    mcMemory,
    setMcMemory,
    setCreateMcPortEl,
    mcPort,
    setMcPort,
    mcFrpEnabled,
    setMcFrpEnabled,
    mcFrpMode,
    setMcFrpMode,
    frpNodeDropdownOptions,
    mcFrpNodeId,
    setMcFrpNodeId,
    setCreateMcFrpNodeEl,
    setCreateMcFrpConfigEl,
    mcFrpConfig,
    setMcFrpConfig,
  } = props as any

  let importPackFileEl: HTMLInputElement | undefined

  return (
                      <Show
                        when={
                          selectedTemplate() === CREATE_TEMPLATE_MINECRAFT ||
                          Boolean(MINECRAFT_MODE_BY_TEMPLATE_ID[selectedTemplate()])
                        }
                      >
                        <div class="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                          <div class="flex flex-wrap items-center justify-between gap-3">
                            <div class="flex flex-wrap items-center gap-3">
                              <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                {t('instancesCreate.section.minecraft')}
                              </div>
                              <Tabs
                                value={mcCreateMode()}
                                options={minecraftCreateModeOptions()}
                                onChange={(mode) => {
                                  setSelectedTemplate(CREATE_TEMPLATE_MINECRAFT)
                                  setMcCreateMode(mode)
                                }}
                              />
                            </div>
                            <Button
                              size="xs"
                              variant={createAdvanced() ? 'secondary' : 'ghost'}
                              onClick={() => setCreateAdvanced((v: boolean) => !v)}
                              title={t('instancesCreate.advancedToggleTitle')}
                            >
                              <span class="inline-flex items-center gap-2">
                                {createAdvanced() ? t('instancesCreate.hideAdvanced') : t('instancesCreate.advanced')}
                                <Show when={!createAdvanced() && createAdvancedDirty()}>
                                  <span class="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                                </Show>
                              </span>
                            </Button>
                          </div>

                          <div class="rounded-2xl border border-slate-200 bg-white/70 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                            <label for="mc-eula" class="flex items-start gap-3 text-sm text-slate-800 dark:text-slate-300">
                              <input
                                ref={(el) => {
                                  setCreateMcEulaEl?.(el)
                                }}
                                id="mc-eula"
                                type="checkbox"
                                class="mt-0.5 h-4 w-4 rounded border-slate-300 bg-white text-amber-600 focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:border-slate-700 dark:bg-slate-950/60 dark:text-amber-400 dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950"
                                checked={mcEula()}
                                onChange={(e) => setMcEula(e.currentTarget.checked)}
                              />
                              <span class="leading-tight">
                                 {t('instancesCreate.minecraftEulaAcceptPrefix')}{' '}
                                 <Link href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer noopener">
                                   {t('instancesCreate.minecraftEulaLinkLabel')}
                                 </Link>
                                 <span class="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                                   {t('instancesCreate.minecraftEulaRequiredHint')}
                                 </span>
                               </span>
                             </label>
                            <Show when={createFieldErrors().accept_eula}>
                              <div class="mt-2 text-[12px] text-rose-700 dark:text-rose-300">{createFieldErrors().accept_eula}</div>
                            </Show>
                          </div>

                          <Show when={createTemplateId() === 'minecraft:import'}>
                            <Field
                              label={
                                <LabelTip
                                  label={t('instancesCreate.minecraftImport.packLabel')}
                                  content={t('instancesCreate.minecraftImport.packHint')}
                                />
                              }
                              required
                              error={createFieldErrors().pack}
                            >
                              <div class="space-y-2">
                                <div ref={(el) => setCreateMcImportPackEl?.(el)}>
                                  <Dropdown
                                    label=""
                                    value={mcImportPack()}
                                    options={mcImportPackOptions()}
                                    placeholder={
                                      mcImportPacksPending()
                                        ? t('instancesCreate.minecraftImport.loadingUploadedZips')
                                        : t('instancesCreate.minecraftImport.selectUploadedZip')
                                    }
                                    onChange={(value) => {
                                      if (value === '__upload__') {
                                        importPackFileEl?.click()
                                        return
                                      }
                                      setMcImportPack(value)
                                    }}
                                  />
                                </div>
                                <input
                                  ref={(el) => {
                                    importPackFileEl = el
                                  }}
                                  type="file"
                                  accept=".zip,application/zip"
                                  class="hidden"
                                  onChange={async (e) => {
                                    const file = e.currentTarget.files?.[0]
                                    if (!file) return
                                    await uploadMcImportPackFile(file)
                                    e.currentTarget.value = ''
                                  }}
                                />
                                <Show when={mcImportUploadPending()}>
                                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                                    {t('instancesCreate.minecraftImport.uploadingZip')}
                                  </div>
                                </Show>
                              </div>
                            </Field>
                          </Show>

                          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Show when={createTemplateId() === 'minecraft:vanilla'}>
                              <Field
                                label={<LabelTip label={t('instancesCreate.minecraft.versionLabel')} content={t('instancesCreate.minecraft.versionHint')} />}
                                error={createFieldErrors().version}
                              >
                                <Dropdown
                                  label=""
                                  value={mcVersion()}
                                  options={optionsWithCurrentValue(mcVersionOptions(), mcVersion())}
                                  onChange={setMcVersion}
                                />
                              </Field>
                            </Show>

                            <Field
                              class={createTemplateId() === 'minecraft:vanilla' ? '' : 'sm:col-span-2'}
                              label={<LabelTip label={t('instancesCreate.minecraft.memoryLabel')} content={t('instancesCreate.minecraft.memoryHint')} />}
                              error={createFieldErrors().memory_mb}
                            >
                              <Input
                                ref={(el) => {
                                  setCreateMcMemoryEl?.(el)
                                }}
                                type="number"
                                value={mcMemory()}
                                onInput={(e) => setMcMemory(e.currentTarget.value)}
                                placeholder="2048"
                                invalid={Boolean(createFieldErrors().memory_mb)}
                              />
                            </Field>
                          </div>

                          <Show when={createAdvanced()}>
                            <div class="space-y-3">
                              <Field
                                label={<LabelTip label={t('instancesCreate.common.portOptionalLabel')} content={t('instancesCreate.common.portOptionalHint')} />}
                                error={createFieldErrors().port}
                              >
                                <Input
                                  ref={(el) => {
                                    setCreateMcPortEl?.(el)
                                  }}
                                  type="number"
                                  value={mcPort()}
                                  onInput={(e) => setMcPort(e.currentTarget.value)}
                                  placeholder="25565"
                                  invalid={Boolean(createFieldErrors().port)}
                                />
                              </Field>

                              <Field
                                label={<LabelTip label={t('instancesCreate.tunnels.publicLabel')} content={t('instancesCreate.tunnels.publicHint')} />}
                                error={createFieldErrors().frp_config}
                              >
                                <div class="space-y-2">
                                  <label class="inline-flex items-center gap-2 text-[12px] text-slate-700 dark:text-slate-200">
                                    <input
                                      type="checkbox"
                                      class="h-4 w-4 rounded border-slate-300 bg-white text-amber-600 focus:ring-amber-400 dark:border-slate-700 dark:bg-slate-950/60 dark:text-amber-400"
                                      checked={mcFrpEnabled()}
                                      onChange={(e) => setMcFrpEnabled(e.currentTarget.checked)}
                                    />
                                     <span>{t('instancesCreate.enable')}</span>
                                   </label>
                                  <Show when={mcFrpEnabled()}>
                                    <div class="space-y-2">
                                      <div class="flex flex-wrap items-center justify-between gap-2">
                                        <Tabs
                                          value={mcFrpMode()}
                                           options={[
                                             { value: 'paste', label: t('instancesCreate.tunnels.paste') },
                                             { value: 'node', label: t('instancesCreate.tunnels.node') },
                                           ]}
                                          onChange={(mode) => {
                                            setMcFrpMode(mode)
                                            if (mode === 'paste') setMcFrpNodeId('')
                                            if (mode === 'node') setMcFrpConfig('')
                                          }}
                                        />
                                        <Button size="xs" variant="secondary" onClick={() => setTab('frp')}>
                                          {t('instancesCreate.tunnels.manageNodes')}
                                        </Button>
                                      </div>

                                      <Show when={mcFrpMode() === 'node'}>
                                        <div
                                          ref={(el) => {
                                            setCreateMcFrpNodeEl?.(el)
                                          }}
                                        >
                                          <Dropdown
                                            label=""
                                            value={mcFrpNodeId()}
                                            options={frpNodeDropdownOptions()}
                                            placeholder={t('instancesCreate.tunnels.selectNode')}
                                            onChange={setMcFrpNodeId}
                                          />
                                        </div>
                                        <div class="text-[11px] text-slate-500 dark:text-slate-400">
                                          {t('instancesCreate.tunnels.nodeHintPrefix')}{' '}
                                          <span class="font-mono">local_port</span>{' '}
                                          {t('instancesCreate.tunnels.nodeHintSuffix')}
                                        </div>
                                      </Show>

                                      <Show when={mcFrpMode() === 'paste'}>
                                        <Textarea
                                          ref={(el) => {
                                            setCreateMcFrpConfigEl?.(el)
                                          }}
                                          value={mcFrpConfig()}
                                          onInput={(e) => setMcFrpConfig(e.currentTarget.value)}
                                          placeholder={t('instancesCreate.tunnels.pastePlaceholder')}
                                          spellcheck={false}
                                          class="font-mono text-[11px]"
                                          invalid={Boolean(createFieldErrors().frp_config)}
                                        />
                                      </Show>
                                    </div>
                                  </Show>
                                </div>
                              </Field>
                            </div>
                          </Show>
                        </div>
                      </Show>
  )
}
