import { Show } from 'solid-js'
import { LabelTip } from '../../app/primitives/LabelTip'
import { VisibilityToggle } from '../../app/primitives/VisibilityToggle'
import { Button } from '../../components/ui/Button'
import { Dropdown } from '../../components/Dropdown'
import { Field } from '../../components/ui/Field'
import { Input } from '../../components/ui/Input'

export type DspCreateSectionProps = {
  [key: string]: unknown
}

export default function DspCreateSection(props: DspCreateSectionProps) {
  const {
    selectedTemplate,
    createAdvanced,
    setCreateAdvanced,
    createAdvancedDirty,
    createFieldErrors,
    setCreateDspStartupModeEl,
    dspStartupMode,
    setDspStartupMode,
    setCreateDspSaveNameEl,
    dspSaveName,
    setDspSaveName,
    setCreateDspPortEl,
    dspPort,
    setDspPort,
    setCreateDspUpsEl,
    dspUps,
    setDspUps,
    setCreateDspWineBinEl,
    dspWineBin,
    setDspWineBin,
    setCreateDspServerPasswordEl,
    dspServerPasswordVisible,
    dspServerPassword,
    setDspServerPassword,
    setDspServerPasswordVisible,
    setCreateDspRemoteAccessPasswordEl,
    dspRemoteAccessPasswordVisible,
    dspRemoteAccessPassword,
    setDspRemoteAccessPassword,
    setDspRemoteAccessPasswordVisible,
    dspAutoPauseEnabled,
    setDspAutoPauseEnabled,
  } = props as any

  return (
                      <Show when={selectedTemplate() === 'dsp:nebula'}>
                        <div class="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                          <div class="flex items-center justify-between gap-3">
                            <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                              Dyson Sphere Program (Nebula)
                            </div>
                            <Button
                              size="xs"
                              variant={createAdvanced() ? 'secondary' : 'ghost'}
                              onClick={() => setCreateAdvanced((v: boolean) => !v)}
                              title="Show or hide advanced fields"
                            >
                              <span class="inline-flex items-center gap-2">
                                {createAdvanced() ? 'Hide advanced' : 'Advanced'}
                                <Show when={!createAdvanced() && createAdvancedDirty()}>
                                  <span class="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                                </Show>
                              </span>
                            </Button>
                          </div>

                          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field
                              label={
                                <LabelTip
                                  label="Startup mode"
                                  content="auto/load_latest/load/newgame_default/newgame_cfg. load requires Save name."
                                />
                              }
                              error={createFieldErrors().startup_mode}
                            >
                              <div
                                ref={(el) => {
                                  setCreateDspStartupModeEl?.(el)
                                }}
                              >
                                <Dropdown
                                  label=""
                                  value={dspStartupMode()}
                                  options={[
                                    { value: 'auto', label: 'Auto' },
                                    { value: 'load_latest', label: 'Load latest' },
                                    { value: 'load', label: 'Load specific save' },
                                    { value: 'newgame_default', label: 'New game (default cfg)' },
                                    { value: 'newgame_cfg', label: 'New game (Nebula cfg)' },
                                  ]}
                                  onChange={setDspStartupMode}
                                />
                              </div>
                            </Field>

                            <Field
                              label={<LabelTip label="Save name (optional)" content="Required only when Startup mode = load. No .dsv suffix." />}
                              required={dspStartupMode() === 'load'}
                              error={createFieldErrors().save_name}
                            >
                              <Input
                                ref={(el) => {
                                  setCreateDspSaveNameEl?.(el)
                                }}
                                value={dspSaveName()}
                                onInput={(e) => setDspSaveName(e.currentTarget.value)}
                                placeholder="MyFactory"
                                spellcheck={false}
                                invalid={Boolean(createFieldErrors().save_name)}
                              />
                            </Field>
                          </div>

                          <Show when={createAdvanced()}>
                            <div class="space-y-3">
                              <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                <Field
                                  label={<LabelTip label="Port (optional)" content="TCP bind port. 0 or blank means auto-assign." />}
                                  error={createFieldErrors().port}
                                >
                                  <Input
                                    ref={(el) => {
                                      setCreateDspPortEl?.(el)
                                    }}
                                    type="number"
                                    value={dspPort()}
                                    onInput={(e) => setDspPort(e.currentTarget.value)}
                                    placeholder="8469"
                                    invalid={Boolean(createFieldErrors().port)}
                                  />
                                </Field>

                                <Field label={<LabelTip label="UPS" content="Simulation UPS. Range 1..240." />} error={createFieldErrors().ups}>
                                  <Input
                                    ref={(el) => {
                                      setCreateDspUpsEl?.(el)
                                    }}
                                    type="number"
                                    value={dspUps()}
                                    onInput={(e) => setDspUps(e.currentTarget.value)}
                                    placeholder="60"
                                    invalid={Boolean(createFieldErrors().ups)}
                                  />
                                </Field>

                                <Field label={<LabelTip label="Wine binary" content="Wine executable used to run DSPGAME.exe." />} error={createFieldErrors().wine_bin}>
                                  <Input
                                    ref={(el) => {
                                      setCreateDspWineBinEl?.(el)
                                    }}
                                    value={dspWineBin()}
                                    onInput={(e) => setDspWineBin(e.currentTarget.value)}
                                    placeholder="wine64"
                                    spellcheck={false}
                                    invalid={Boolean(createFieldErrors().wine_bin)}
                                    class="font-mono text-[11px]"
                                  />
                                </Field>
                              </div>

                              <Field
                                label={<LabelTip label="Server password (optional)" content="Optional player join password." />}
                                error={createFieldErrors().server_password}
                              >
                                <div class="flex flex-wrap items-center gap-2">
                                  <Input
                                    ref={(el) => {
                                      setCreateDspServerPasswordEl?.(el)
                                    }}
                                    type={dspServerPasswordVisible() ? 'text' : 'password'}
                                    value={dspServerPassword()}
                                    onInput={(e) => setDspServerPassword(e.currentTarget.value)}
                                    invalid={Boolean(createFieldErrors().server_password)}
                                    class="w-full flex-1"
                                    rightIcon={
                                      <VisibilityToggle
                                        visible={dspServerPasswordVisible()}
                                        labelWhenHidden="Show password"
                                        labelWhenVisible="Hide password"
                                        onToggle={() => setDspServerPasswordVisible((v: boolean) => !v)}
                                      />
                                    }
                                  />
                                </div>
                              </Field>

                              <Field
                                label={<LabelTip label="Remote password (optional)" content="Optional Nebula remote access password." />}
                                error={createFieldErrors().remote_access_password}
                              >
                                <div class="flex flex-wrap items-center gap-2">
                                  <Input
                                    ref={(el) => {
                                      setCreateDspRemoteAccessPasswordEl?.(el)
                                    }}
                                    type={dspRemoteAccessPasswordVisible() ? 'text' : 'password'}
                                    value={dspRemoteAccessPassword()}
                                    onInput={(e) => setDspRemoteAccessPassword(e.currentTarget.value)}
                                    invalid={Boolean(createFieldErrors().remote_access_password)}
                                    class="w-full flex-1"
                                    rightIcon={
                                      <VisibilityToggle
                                        visible={dspRemoteAccessPasswordVisible()}
                                        labelWhenHidden="Show password"
                                        labelWhenVisible="Hide password"
                                        onToggle={() => setDspRemoteAccessPasswordVisible((v: boolean) => !v)}
                                      />
                                    }
                                  />
                                </div>
                              </Field>

                              <Field
                                label={<LabelTip label="Auto pause when empty" content="Pause simulation automatically when no players are connected." />}
                                error={createFieldErrors().auto_pause_enabled}
                              >
                                <label class="inline-flex items-center gap-2 text-[12px] text-slate-700 dark:text-slate-200">
                                  <input
                                    type="checkbox"
                                    class="h-4 w-4 rounded border-slate-300 bg-white text-amber-600 focus:ring-amber-400 dark:border-slate-700 dark:bg-slate-950/60 dark:text-amber-400"
                                    checked={dspAutoPauseEnabled()}
                                    onChange={(e) => setDspAutoPauseEnabled(e.currentTarget.checked)}
                                  />
                                  <span>Enable</span>
                                </label>
                              </Field>
                            </div>
                          </Show>
                        </div>
                      </Show>
  )
}
