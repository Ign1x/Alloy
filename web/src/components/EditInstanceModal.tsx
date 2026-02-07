import { For, Show } from 'solid-js'
import { isAlloyApiError } from '../rspc'
import { LabelTip } from '../app/primitives/LabelTip'
import { VisibilityToggle } from '../app/primitives/VisibilityToggle'
import { Dropdown } from './Dropdown'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
import { IconButton } from './ui/IconButton'
import { Input } from './ui/Input'
import { Modal } from './ui/Modal'
import { Tabs } from './ui/Tabs'
import { Textarea } from './ui/Textarea'

export type EditInstanceModalProps = {
  [key: string]: unknown
}

export default function EditInstanceModal(props: EditInstanceModalProps) {
  const {
    editingInstanceId,
    editBase,
    closeEditModal,
    setEditDisplayNameEl,
    setEditSleepSecondsEl,
    setEditMcMemoryEl,
    setEditMcPortEl,
    setEditMcFrpNodeEl,
    setEditMcFrpConfigEl,
    setEditTrMaxPlayersEl,
    setEditTrWorldNameEl,
    setEditTrPortEl,
    setEditTrWorldSizeEl,
    setEditTrPasswordEl,
    setEditTrFrpNodeEl,
    setEditTrFrpConfigEl,
    setEditDisplayName,
    editDisplayName,
    editTemplateId,
    editSleepSeconds,
    setEditSleepSeconds,
    editFieldErrors,
    editFormError,
    setEditFieldErrors,
    setEditFormError,
    updateInstance,
    editOutgoingParams,
    invalidateInstances,
    revealInstance,
    pushToast,
    focusFirstEditError,
    friendlyErrorMessage,
    editAdvanced,
    setEditAdvanced,
    editAdvancedDirty,
    editHasChanges,
    editChangedKeys,
    editRisk,
    safeCopy,
    setTab,
    editMcVersion,
    setEditMcVersion,
    mcVersionOptions,
    optionsWithCurrentValue,
    editMcMemory,
    setEditMcMemory,
    editMcPort,
    setEditMcPort,
    editMcFrpEnabled,
    setEditMcFrpEnabled,
    setEditMcFrpMode,
    setEditMcFrpNodeId,
    editMcFrpMode,
    editMcFrpNodeId,
    frpNodeDropdownOptions,
    editMcFrpConfig,
    setEditMcFrpConfig,
    editTrVersion,
    setEditTrVersion,
    trVersionOptions,
    editTrMaxPlayers,
    setEditTrMaxPlayers,
    editTrWorldName,
    setEditTrWorldName,
    editTrPort,
    setEditTrPort,
    editTrWorldSize,
    setEditTrWorldSize,
    editTrPasswordVisible,
    setEditTrPasswordVisible,
    editTrPassword,
    setEditTrPassword,
    editTrFrpEnabled,
    setEditTrFrpEnabled,
    setEditTrFrpMode,
    setEditTrFrpNodeId,
    editTrFrpMode,
    editTrFrpNodeId,
    editTrFrpConfig,
    setEditTrFrpConfig,
    frpNodeConfigById,
  } = props as any

  return (
        <Modal
          open={editingInstanceId() != null && editBase() != null}
          onClose={() => closeEditModal()}
          title="Edit instance"
          size="lg"
        >
          <div class="px-6 py-6">
                <div class="flex items-start gap-3">
                  <div class="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
                      <path d="M5.433 13.69A4.5 4.5 0 0110 6.5h.25a.75.75 0 000-1.5H10a6 6 0 00-5.9 4.91.75.75 0 00.58.88.75.75 0 00.88-.58 4.5 4.5 0 01-.127 3.5z" />
                      <path d="M14.567 6.31A4.5 4.5 0 0110 13.5h-.25a.75.75 0 000 1.5H10a6 6 0 005.9-4.91.75.75 0 00-.58-.88.75.75 0 00-.88.58 4.5 4.5 0 01.127-3.5z" />
                    </svg>
                  </div>
                  <div class="min-w-0">
                    <h3 class="text-base font-semibold text-slate-900 dark:text-slate-100">Edit instance</h3>
                    <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      <span class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {editBase()!.instance_id}
                      </span>
                      <span class="mx-2 text-slate-300 dark:text-slate-700">/</span>
                      <span class="font-mono text-[12px] text-slate-600 dark:text-slate-300">{editBase()!.template_id}</span>
                    </p>
                  </div>
                  <div class="ml-auto flex items-center gap-2">
                    <span
                      class={`rounded-full border px-2 py-1 text-[11px] font-semibold tracking-wide ${
                        editHasChanges()
                          ? 'border-amber-300 bg-amber-500/10 text-amber-800 dark:border-amber-500/30 dark:text-amber-200'
                          : 'border-slate-200 bg-white/60 text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400'
                      }`}
                    >
                      {editHasChanges() ? `${editChangedKeys().length} change(s)` : 'No changes'}
                    </span>
                  </div>
                </div>

                <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-[12px] text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
                  <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Notes</div>
                  <ul class="mt-2 space-y-1 text-[12px] text-slate-600 dark:text-slate-300">
                    <li>Changes apply on next start.</li>
                    <li>Stop the instance before editing (required).</li>
                  </ul>
                  <Show when={editRisk().length > 0}>
                    <div class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
                      <div class="text-xs font-semibold uppercase tracking-wider text-amber-700/80 dark:text-amber-200/80">Risk</div>
                      <ul class="mt-1 space-y-1">
                        <For each={editRisk()}>{(r) => <li>{r}</li>}</For>
                      </ul>
                    </div>
                  </Show>
                </div>

                <div class="mt-5 space-y-3">
                  <Field label="Display name (optional)" error={editFieldErrors().display_name}>
                    <Input
                      ref={(el) => {
                        setEditDisplayNameEl?.(el)
                      }}
                      value={editDisplayName()}
                      onInput={(e) => setEditDisplayName(e.currentTarget.value)}
                      placeholder="e.g. friends-survival"
                      invalid={Boolean(editFieldErrors().display_name)}
                      spellcheck={false}
                    />
                  </Field>

                  <Show when={editTemplateId() === 'demo:sleep'}>
                    <Field label="Seconds" required error={editFieldErrors().seconds}>
                      <Input
                        ref={(el) => {
                          setEditSleepSecondsEl?.(el)
                        }}
                        type="number"
                        value={editSleepSeconds()}
                        onInput={(e) => setEditSleepSeconds(e.currentTarget.value)}
                        invalid={Boolean(editFieldErrors().seconds)}
                      />
                    </Field>
                  </Show>

                  <Show when={editTemplateId() === 'minecraft:vanilla'}>
                    <div class="space-y-3 rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                      <div class="flex items-center justify-between gap-3">
                        <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Minecraft</div>
                        <div class="flex items-center gap-2">
                          <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 text-[11px] font-mono text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                            EULA accepted
                          </span>
                          <Button
                            size="xs"
                            variant={editAdvanced() ? 'secondary' : 'ghost'}
                            onClick={() => setEditAdvanced((v: boolean) => !v)}
                            title="Show or hide advanced fields"
                          >
                            <span class="inline-flex items-center gap-2">
                              {editAdvanced() ? 'Hide advanced' : 'Advanced'}
                              <Show when={!editAdvanced() && editAdvancedDirty()}>
                                <span class="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                              </Show>
                            </span>
                          </Button>
                        </div>
                      </div>

		                      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		                        <Field
		                          label={
		                            <LabelTip
		                              label="Version"
		                              content="Changing version may trigger downloads and compatibility issues."
		                            />
		                          }
		                          error={editFieldErrors().version}
		                        >
                              <div class="space-y-2">
                                <Dropdown
                                  label=""
                                  value={editMcVersion()}
                                  options={optionsWithCurrentValue(mcVersionOptions(), editMcVersion())}
                                  onChange={setEditMcVersion}
                                />
                              </div>
	                        </Field>

	                        <Field
	                          label={
	                            <LabelTip
	                              label="Memory (MB)"
	                              content="Sets JVM heap size. Too low can crash; too high can starve the host."
	                            />
	                          }
	                          error={editFieldErrors().memory_mb}
	                        >
                          <Input
                            ref={(el) => {
                              setEditMcMemoryEl?.(el)
                            }}
                            type="number"
                            value={editMcMemory()}
                            onInput={(e) => setEditMcMemory(e.currentTarget.value)}
                            placeholder="2048"
                            invalid={Boolean(editFieldErrors().memory_mb)}
                          />
                        </Field>
                      </div>

	                      <Show when={editAdvanced()}>
	                        <div class="space-y-3">
	                          <Field
	                            label={
	                              <LabelTip
	                                label="Port (0 = auto)"
	                                content="Applied on next start. Use 0 to auto-assign a free port."
	                              />
	                            }
	                            error={editFieldErrors().port}
	                          >
                              <Input
                                ref={(el) => {
                                  setEditMcPortEl?.(el)
                                }}
                                type="number"
                                value={editMcPort()}
                                onInput={(e) => setEditMcPort(e.currentTarget.value)}
                                placeholder="0 for auto"
                                invalid={Boolean(editFieldErrors().port)}
                              />
                            </Field>

	                          <Field
	                            label={<LabelTip label="Public (FRP)" content="Optional. Paste an FRP config to expose this instance (auto-detects INI/TOML/YAML/JSON)." />}
	                            error={editFieldErrors().frp_config}
	                          >
	                            <div class="space-y-2">
	                              <label class="inline-flex items-center gap-2 text-[12px] text-slate-700 dark:text-slate-200">
	                                <input
	                                  type="checkbox"
	                                  class="h-4 w-4 rounded border-slate-300 bg-white text-amber-600 focus:ring-amber-400 dark:border-slate-700 dark:bg-slate-950/60 dark:text-amber-400"
	                                  checked={editMcFrpEnabled()}
	                                  onChange={(e) => {
	                                    setEditMcFrpEnabled(e.currentTarget.checked)
	                                    if (!e.currentTarget.checked) {
	                                      setEditMcFrpConfig('')
	                                      setEditMcFrpMode('paste')
	                                      setEditMcFrpNodeId('')
	                                    }
	                                  }}
	                                />
	                                <span>Enable</span>
	                              </label>
	                              <Show when={editMcFrpEnabled()}>
	                                <div class="space-y-2">
	                                  <div class="flex flex-wrap items-center justify-between gap-2">
	                                    <Tabs
	                                      value={editMcFrpMode()}
	                                      options={[
	                                        { value: 'paste', label: 'Paste' },
	                                        { value: 'node', label: 'Node' },
	                                      ]}
	                                      onChange={(mode) => {
	                                        setEditMcFrpMode(mode)
	                                        if (mode === 'paste') setEditMcFrpNodeId('')
	                                        if (mode === 'node') setEditMcFrpConfig('')
	                                      }}
	                                    />
	                                    <Button size="xs" variant="secondary" onClick={() => setTab('frp')}>
	                                      Manage nodes
	                                    </Button>
	                                  </div>

	                                  <Show when={editMcFrpMode() === 'node'}>
	                                    <div
	                                      ref={(el) => {
	                                        setEditMcFrpNodeEl?.(el)
	                                      }}
	                                    >
	                                      <Dropdown
	                                        label=""
	                                        value={editMcFrpNodeId()}
	                                        options={frpNodeDropdownOptions()}
	                                        placeholder="Select node…"
	                                        onChange={setEditMcFrpNodeId}
	                                      />
	                                    </div>
	                                    <div class="text-[11px] text-slate-500 dark:text-slate-400">
	                                      If you don’t select a node, the existing config (if any) stays unchanged.
	                                    </div>
	                                  </Show>

	                                  <Show when={editMcFrpMode() === 'paste'}>
	                                    <Textarea
	                                      ref={(el) => {
	                                        setEditMcFrpConfigEl?.(el)
	                                      }}
	                                      value={editMcFrpConfig()}
	                                      onInput={(e) => setEditMcFrpConfig(e.currentTarget.value)}
	                                      placeholder="Paste FRP config to set/replace (auto: INI/TOML/YAML/JSON)"
	                                      spellcheck={false}
	                                      class="font-mono text-[11px]"
	                                      invalid={Boolean(editFieldErrors().frp_config)}
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

                  <Show when={editTemplateId() === 'terraria:vanilla'}>
                    <div class="space-y-3 rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                      <div class="flex items-center justify-between gap-3">
                        <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Terraria</div>
                        <Button
                          size="xs"
                          variant={editAdvanced() ? 'secondary' : 'ghost'}
                          onClick={() => setEditAdvanced((v: boolean) => !v)}
                          title="Show or hide advanced fields"
                        >
                          <span class="inline-flex items-center gap-2">
                            {editAdvanced() ? 'Hide advanced' : 'Advanced'}
                            <Show when={!editAdvanced() && editAdvancedDirty()}>
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
		                              content="Package id (e.g. 1453). Changing version may require re-download and can affect world compatibility."
		                            />
		                          }
		                          error={editFieldErrors().version}
		                        >
                            <div class="space-y-2">
                              <Dropdown
                                label=""
                                value={editTrVersion()}
                                options={optionsWithCurrentValue(trVersionOptions(), editTrVersion())}
                                onChange={setEditTrVersion}
                              />
                            </div>
	                        </Field>

	                        <Field
	                          label={<LabelTip label="Max players" content="Maximum concurrent players allowed to join." />}
	                          error={editFieldErrors().max_players}
	                        >
                          <Input
                            ref={(el) => {
                              setEditTrMaxPlayersEl?.(el)
                            }}
                            type="number"
                            value={editTrMaxPlayers()}
                            onInput={(e) => setEditTrMaxPlayers(e.currentTarget.value)}
                            placeholder="8"
                            invalid={Boolean(editFieldErrors().max_players)}
                          />
                        </Field>
                      </div>

	                      <Field
	                        label={
	                          <LabelTip
	                            label="World name"
	                            content="Changing world name will use a different world file (existing worlds are not deleted)."
	                          />
	                        }
	                        error={editFieldErrors().world_name}
	                      >
                        <Input
                          ref={(el) => {
                            setEditTrWorldNameEl?.(el)
                          }}
                          value={editTrWorldName()}
                          onInput={(e) => setEditTrWorldName(e.currentTarget.value)}
                          placeholder="world"
                          invalid={Boolean(editFieldErrors().world_name)}
                        />
                      </Field>

	                      <Show when={editAdvanced()}>
	                        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
	                          <Field
	                            label={
	                              <LabelTip
	                                label="Port (0 = auto)"
	                                content="Applied on next start. Use 0 to auto-assign a free port."
	                              />
	                            }
	                            error={editFieldErrors().port}
	                          >
                            <Input
                              ref={(el) => {
                                setEditTrPortEl?.(el)
                              }}
                              type="number"
                              value={editTrPort()}
                              onInput={(e) => setEditTrPort(e.currentTarget.value)}
                              placeholder="0 for auto"
                              invalid={Boolean(editFieldErrors().port)}
                            />
                          </Field>

	                          <Field
	                            label={<LabelTip label="World size (1/2/3)" content="1=small, 2=medium, 3=large." />}
	                            error={editFieldErrors().world_size}
	                          >
                            <Input
                              ref={(el) => {
                                setEditTrWorldSizeEl?.(el)
                              }}
                              type="number"
                              value={editTrWorldSize()}
                              onInput={(e) => setEditTrWorldSize(e.currentTarget.value)}
                              placeholder="1"
                              invalid={Boolean(editFieldErrors().world_size)}
                            />
                          </Field>
                        </div>

	                        <Field
	                          label={<LabelTip label="Password (optional)" content="Leave blank to keep existing; set a value to change." />}
	                          error={editFieldErrors().password}
	                        >
	                          <div class="flex flex-wrap items-center gap-2">
	                          <Input
	                          ref={(el) => {
	                          setEditTrPasswordEl?.(el)
	                          }}
	                          type={editTrPasswordVisible() ? 'text' : 'password'}
	                          value={editTrPassword()}
	                          onInput={(e) => setEditTrPassword(e.currentTarget.value)}
	                          placeholder="(leave blank to keep)"
	                          invalid={Boolean(editFieldErrors().password)}
	                          class="w-full flex-1"
	                            rightIcon={
	                              <VisibilityToggle
	                              visible={editTrPasswordVisible()}
	                              labelWhenHidden="Show password"
	                              labelWhenVisible="Hide password"
	                              onToggle={() => setEditTrPasswordVisible((v: boolean) => !v)}
	                            />
	                            }
	                          />
	                          <IconButton
	                              type="button"
	                              size="sm"
	                              variant="secondary"
	                              label="Copy password"
	                              disabled={!editTrPassword().trim()}
	                              onClick={() => void safeCopy(editTrPassword())}
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
	                          error={editFieldErrors().frp_config}
	                        >
	                          <div class="space-y-2">
	                            <label class="inline-flex items-center gap-2 text-[12px] text-slate-700 dark:text-slate-200">
	                              <input
	                                type="checkbox"
	                                class="h-4 w-4 rounded border-slate-300 bg-white text-amber-600 focus:ring-amber-400 dark:border-slate-700 dark:bg-slate-950/60 dark:text-amber-400"
	                                checked={editTrFrpEnabled()}
	                                onChange={(e) => {
	                                  setEditTrFrpEnabled(e.currentTarget.checked)
	                                  if (!e.currentTarget.checked) {
	                                    setEditTrFrpConfig('')
	                                    setEditTrFrpMode('paste')
	                                    setEditTrFrpNodeId('')
	                                  }
	                                }}
	                              />
	                              <span>Enable</span>
	                            </label>
	                            <Show when={editTrFrpEnabled()}>
	                              <div class="space-y-2">
	                                <div class="flex flex-wrap items-center justify-between gap-2">
	                                  <Tabs
	                                    value={editTrFrpMode()}
	                                    options={[
	                                      { value: 'paste', label: 'Paste' },
	                                      { value: 'node', label: 'Node' },
	                                    ]}
	                                    onChange={(mode) => {
	                                      setEditTrFrpMode(mode)
	                                      if (mode === 'paste') setEditTrFrpNodeId('')
	                                      if (mode === 'node') setEditTrFrpConfig('')
	                                    }}
	                                  />
	                                  <Button size="xs" variant="secondary" onClick={() => setTab('frp')}>
	                                    Manage nodes
	                                  </Button>
	                                </div>

	                                <Show when={editTrFrpMode() === 'node'}>
	                                  <div
	                                    ref={(el) => {
	                                      setEditTrFrpNodeEl?.(el)
	                                    }}
	                                  >
	                                    <Dropdown
	                                      label=""
	                                      value={editTrFrpNodeId()}
	                                      options={frpNodeDropdownOptions()}
	                                      placeholder="Select node…"
	                                      onChange={setEditTrFrpNodeId}
	                                    />
	                                  </div>
	                                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
	                                    If you don’t select a node, the existing config (if any) stays unchanged.
	                                  </div>
	                                </Show>

	                                <Show when={editTrFrpMode() === 'paste'}>
	                                  <Textarea
	                                    ref={(el) => {
	                                      setEditTrFrpConfigEl?.(el)
	                                    }}
	                                    value={editTrFrpConfig()}
	                                    onInput={(e) => setEditTrFrpConfig(e.currentTarget.value)}
	                                    placeholder="Paste FRP config to set/replace (auto: INI/TOML/YAML/JSON)"
	                                    spellcheck={false}
	                                    class="font-mono text-[11px]"
	                                    invalid={Boolean(editFieldErrors().frp_config)}
	                                  />
	                                </Show>
	                              </div>
	                            </Show>
	                          </div>
	                        </Field>
                      </Show>
                    </div>
                  </Show>

                  <Show when={editFormError()}>
                    <div class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                      <div class="font-semibold">Update failed</div>
                      <div class="mt-1">{editFormError()!.message}</div>
	                      <Show when={editFormError()!.requestId}>
	                        <div class="mt-2 flex items-center justify-between gap-2">
	                          <div class="text-[11px] text-rose-700/80 dark:text-rose-200/70 font-mono">req {editFormError()!.requestId}</div>
	                          <IconButton
	                            size="sm"
	                            variant="danger"
	                            label="Copy request id"
	                            onClick={() => safeCopy(editFormError()!.requestId ?? '')}
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

                <div class="mt-6 flex gap-3">
                  <Button type="button" variant="secondary" size="md" class="flex-1" onClick={() => closeEditModal()}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    class="flex-1"
                    loading={updateInstance.isPending}
                    disabled={!editHasChanges() || editOutgoingParams() == null}
                    onClick={async () => {
                      const base = editBase()
                      const params = editOutgoingParams()
                      if (!base || !params) return

                      setEditFormError(null)
                      setEditFieldErrors({})
                      const localErrors: Record<string, string> = {}

                      if (base.template_id === 'minecraft:vanilla') {
                        const existing = (base.params.frp_config ?? '').trim()
                        const nextCfg =
                          editMcFrpMode() === 'node'
                            ? frpNodeConfigById(editMcFrpNodeId()) ?? ''
                            : editMcFrpConfig().trim()
                        if (editMcFrpEnabled() && !existing && !nextCfg)
                          localErrors.frp_config = editMcFrpMode() === 'node' ? 'Select an FRP node.' : 'Paste FRP config.'
                      }

                      if (base.template_id === 'terraria:vanilla') {
                        const existing = (base.params.frp_config ?? '').trim()
                        const nextCfg =
                          editTrFrpMode() === 'node'
                            ? frpNodeConfigById(editTrFrpNodeId()) ?? ''
                            : editTrFrpConfig().trim()
                        if (editTrFrpEnabled() && !existing && !nextCfg)
                          localErrors.frp_config = editTrFrpMode() === 'node' ? 'Select an FRP node.' : 'Paste FRP config.'
                      }

                      if (Object.keys(localErrors).length > 0) {
                        setEditFieldErrors(localErrors)
                        queueMicrotask(() => focusFirstEditError(localErrors))
                        return
                      }

                      try {
                        await updateInstance.mutateAsync({
                          instance_id: base.instance_id,
                          params,
                          display_name: editDisplayName().trim() ? editDisplayName().trim() : null,
                        })
                        pushToast('success', 'Updated', 'Instance parameters saved.')
                        closeEditModal()
                        await invalidateInstances()
                        revealInstance(base.instance_id)
                      } catch (err) {
                        if (isAlloyApiError(err)) {
                          setEditFormError({ message: err.data.message, requestId: err.data.request_id })
                          setEditFieldErrors(err.data.field_errors ?? {})
                          queueMicrotask(() => focusFirstEditError(err.data.field_errors ?? {}))
                        } else {
                          setEditFormError({ message: friendlyErrorMessage(err) })
                        }
                      }
                    }}
                  >
                    Save changes
                  </Button>
                </div>
          </div>
        </Modal>
  )
}
