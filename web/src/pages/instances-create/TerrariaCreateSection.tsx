import { Show } from 'solid-js'
import { optionsWithCurrentValue, safeCopy } from '../../app/helpers/misc'
import { LabelTip } from '../../app/primitives/LabelTip'
import { VisibilityToggle } from '../../app/primitives/VisibilityToggle'
import { Button } from '../../components/ui/Button'
import { Dropdown } from '../../components/Dropdown'
import { Field } from '../../components/ui/Field'
import { IconButton } from '../../components/ui/IconButton'
import { Input } from '../../components/ui/Input'
import { Tabs } from '../../components/ui/Tabs'
import { Textarea } from '../../components/ui/Textarea'

export type TerrariaCreateSectionProps = {
  [key: string]: unknown
}

export default function TerrariaCreateSection(props: TerrariaCreateSectionProps) {
  const {
    selectedTemplate,
    createAdvanced,
    setCreateAdvanced,
    createAdvancedDirty,
    createFieldErrors,
    trVersion,
    trVersionOptions,
    setTrVersion,
    setCreateTrMaxPlayersEl,
    trMaxPlayers,
    setTrMaxPlayers,
    setCreateTrWorldNameEl,
    trWorldName,
    setTrWorldName,
    setCreateTrPortEl,
    trPort,
    setTrPort,
    setCreateTrWorldSizeEl,
    trWorldSize,
    setTrWorldSize,
    setCreateTrPasswordEl,
    trPassword,
    setTrPassword,
    trPasswordVisible,
    setTrPasswordVisible,
    trFrpEnabled,
    setTrFrpEnabled,
    trFrpMode,
    setTrFrpMode,
    setCreateTrFrpNodeEl,
    frpNodeDropdownOptions,
    trFrpNodeId,
    setTrFrpNodeId,
    setCreateTrFrpConfigEl,
    trFrpConfig,
    setTrFrpConfig,
    setTab,
  } = props as any

  return (
                      <Show when={selectedTemplate() === 'terraria:vanilla'}>
                        <div class="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                          <div class="flex items-center justify-between gap-3">
                            <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                              Terraria settings
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
		                                  label="Version"
		                                  content="Package id used for version management and compatibility (e.g. 1453)."
		                                />
		                              }
		                              error={createFieldErrors().version}
		                            >
                              <div class="space-y-2">
                                <Dropdown
                                  label=""
                                  value={trVersion()}
                                  options={optionsWithCurrentValue(trVersionOptions(), trVersion())}
                                  onChange={setTrVersion}
                                />
                              </div>
		                            </Field>

		                            <Field
		                              label={<LabelTip label="Max players" content="Maximum concurrent players allowed to join." />}
		                              error={createFieldErrors().max_players}
		                            >
                              <Input
                                ref={(el) => {
                                  setCreateTrMaxPlayersEl?.(el)
                                }}
                                type="number"
                                value={trMaxPlayers()}
                                onInput={(e) => setTrMaxPlayers(e.currentTarget.value)}
                                invalid={Boolean(createFieldErrors().max_players)}
                              />
                            </Field>
                          </div>

	                          <Field
	                            label={
	                              <LabelTip
	                                label="World name"
	                                content="Changing it uses a different world file (existing worlds are not deleted)."
	                              />
	                            }
	                            error={createFieldErrors().world_name}
	                          >
                            <Input
                              ref={(el) => {
                                setCreateTrWorldNameEl?.(el)
                              }}
                              value={trWorldName()}
                              onInput={(e) => setTrWorldName(e.currentTarget.value)}
                              invalid={Boolean(createFieldErrors().world_name)}
                            />
                          </Field>

                          <Show when={createAdvanced()}>
                            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
	                              <Field
	                                label={<LabelTip label="Port (optional)" content="Leave blank for auto-assign." />}
	                                error={createFieldErrors().port}
	                              >
                                <Input
                                  ref={(el) => {
                                    setCreateTrPortEl?.(el)
                                  }}
                                  type="number"
                                  value={trPort()}
                                  onInput={(e) => setTrPort(e.currentTarget.value)}
                                  placeholder="7777"
                                  invalid={Boolean(createFieldErrors().port)}
                                />
                              </Field>

		                              <Field
		                                label={<LabelTip label="World size (1/2/3)" content="1=small, 2=medium, 3=large." />}
		                                error={createFieldErrors().world_size}
		                              >
                                <Input
                                  ref={(el) => {
                                    setCreateTrWorldSizeEl?.(el)
                                  }}
                                  type="number"
                                  value={trWorldSize()}
                                  onInput={(e) => setTrWorldSize(e.currentTarget.value)}
                                  invalid={Boolean(createFieldErrors().world_size)}
                                />
                              </Field>
                            </div>

		                            <Field
		                              label={<LabelTip label="Password (optional)" content="Optional join password." />}
		                              error={createFieldErrors().password}
		                            >
	                              <div class="flex flex-wrap items-center gap-2">
	                              <Input
	                              ref={(el) => {
	                              setCreateTrPasswordEl?.(el)
	                              }}
	                              type={trPasswordVisible() ? 'text' : 'password'}
	                              value={trPassword()}
	                              onInput={(e) => setTrPassword(e.currentTarget.value)}
	                              invalid={Boolean(createFieldErrors().password)}
	                              class="w-full flex-1"
	                                rightIcon={
	                                  <VisibilityToggle
	                                  visible={trPasswordVisible()}
	                                  labelWhenHidden="Show password"
	                                  labelWhenVisible="Hide password"
	                                  onToggle={() => setTrPasswordVisible((v: boolean) => !v)}
	                                />
	                                }
	                              />
	                              <IconButton
	                                  type="button"
	                                  size="sm"
	                                  variant="secondary"
	                                  label="Copy password"
	                                  disabled={!trPassword().trim()}
	                                  onClick={() => void safeCopy(trPassword())}
	                                >
	                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                                    <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
	                                    <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
	                                  </svg>
	                                </IconButton>
	                              </div>
	                            </Field>

	                            <Field
	                              label={<LabelTip label="Public (FRP)" content="Optional. Paste an FRP config to expose this instance (auto-detects INI/TOML/YAML/JSON)." />}
	                              error={createFieldErrors().frp_config}
	                            >
	                              <div class="space-y-2">
	                                <label class="inline-flex items-center gap-2 text-[12px] text-slate-700 dark:text-slate-200">
	                                  <input
	                                    type="checkbox"
	                                    class="h-4 w-4 rounded border-slate-300 bg-white text-amber-600 focus:ring-amber-400 dark:border-slate-700 dark:bg-slate-950/60 dark:text-amber-400"
	                                    checked={trFrpEnabled()}
	                                    onChange={(e) => setTrFrpEnabled(e.currentTarget.checked)}
	                                  />
	                                  <span>Enable</span>
	                                </label>
	                                <Show when={trFrpEnabled()}>
	                                  <div class="space-y-2">
	                                    <div class="flex flex-wrap items-center justify-between gap-2">
	                                      <Tabs
	                                        value={trFrpMode()}
	                                        options={[
	                                          { value: 'paste', label: 'Paste' },
	                                          { value: 'node', label: 'Node' },
	                                        ]}
	                                        onChange={(mode) => {
	                                          setTrFrpMode(mode)
	                                          if (mode === 'paste') setTrFrpNodeId('')
	                                          if (mode === 'node') setTrFrpConfig('')
	                                        }}
	                                      />
	                                      <Button size="xs" variant="secondary" onClick={() => setTab('frp')}>
	                                        Manage nodes
	                                      </Button>
	                                    </div>

	                                    <Show when={trFrpMode() === 'node'}>
	                                      <div
	                                        ref={(el) => {
	                                          setCreateTrFrpNodeEl?.(el)
	                                        }}
	                                      >
	                                        <Dropdown
	                                          label=""
	                                          value={trFrpNodeId()}
	                                          options={frpNodeDropdownOptions()}
	                                          placeholder="Select node…"
	                                          onChange={setTrFrpNodeId}
	                                        />
	                                      </div>
	                                      <div class="text-[11px] text-slate-500 dark:text-slate-400">
	                                        Uses the saved node config and patches <span class="font-mono">local_port</span> (and auto remote port if needed).
	                                      </div>
	                                    </Show>

	                                    <Show when={trFrpMode() === 'paste'}>
	                                      <Textarea
	                                        ref={(el) => {
	                                          setCreateTrFrpConfigEl?.(el)
	                                        }}
	                                        value={trFrpConfig()}
	                                        onInput={(e) => setTrFrpConfig(e.currentTarget.value)}
	                                        placeholder="Paste FRP config (auto: INI/TOML/YAML/JSON)"
	                                        spellcheck={false}
	                                        class="font-mono text-[11px]"
	                                        invalid={Boolean(createFieldErrors().frp_config)}
	                                      />
	                                    </Show>
	                                  </div>
	                                </Show>
	                              </div>
	                            </Field>
                          </Show>
                        </div>
                      </Show>
  )
}
