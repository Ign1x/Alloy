import { Show } from 'solid-js'
import { optionsWithCurrentValue } from '../../app/helpers/misc'
import { LabelTip } from '../../app/primitives/LabelTip'
import { Button } from '../../components/ui/Button'
import { Dropdown } from '../../components/Dropdown'
import { Field } from '../../components/ui/Field'
import { Input } from '../../components/ui/Input'

export type FactorioCreateSectionProps = {
  [key: string]: unknown
}

export default function FactorioCreateSection(props: FactorioCreateSectionProps) {
  const {
    selectedTemplate,
    createAdvanced,
    setCreateAdvanced,
    createAdvancedDirty,
    createFieldErrors,
    fxVersion,
    fxVersionOptions,
    setFxVersion,
    fxServerName,
    setFxServerName,
    fxMaxPlayers,
    setFxMaxPlayers,
    fxPublic,
    setFxPublic,
    fxPort,
    setFxPort,
    setCreateFxPortEl,
    fxServerDescription,
    setFxServerDescription,
    fxRconEnabled,
    setFxRconEnabled,
    fxRconPort,
    setFxRconPort,
    setCreateFxRconPortEl,
    fxRconPassword,
    setFxRconPassword,
    setCreateFxRconPasswordEl,
  } = props as any

  return (
    <Show when={selectedTemplate() === 'factorio:vanilla'}>
      <div class="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
        <div class="flex items-center justify-between gap-3">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Factorio</div>
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
          <Field label={<LabelTip label="Version" content="stable / experimental or explicit version." />} error={createFieldErrors().version}>
            <Dropdown
              label=""
              value={fxVersion()}
              options={optionsWithCurrentValue(fxVersionOptions(), fxVersion())}
              onChange={setFxVersion}
            />
          </Field>

          <Field label={<LabelTip label="Max players" content="Maximum concurrent players." />} error={createFieldErrors().max_players}>
            <Input
              type="number"
              value={fxMaxPlayers()}
              onInput={(e) => setFxMaxPlayers(e.currentTarget.value)}
              placeholder="8"
              invalid={Boolean(createFieldErrors().max_players)}
            />
          </Field>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={<LabelTip label="Server name" content="Shown in multiplayer browser." />} error={createFieldErrors().server_name}>
            <Input
              value={fxServerName()}
              onInput={(e) => setFxServerName(e.currentTarget.value)}
              placeholder="Alloy Factorio server"
              invalid={Boolean(createFieldErrors().server_name)}
            />
          </Field>

          <Field label={<LabelTip label="Port (UDP)" content="Game port. Use 0 to auto-assign." />} error={createFieldErrors().port}>
            <Input
              ref={(el) => {
                setCreateFxPortEl?.(el)
              }}
              type="number"
              value={fxPort()}
              onInput={(e) => setFxPort(e.currentTarget.value)}
              placeholder="34197"
              invalid={Boolean(createFieldErrors().port)}
            />
          </Field>
        </div>

        <Field label={<LabelTip label="Public listing" content="List this server publicly in Factorio browser." />} error={createFieldErrors().public}>
          <label class="inline-flex items-center gap-2 text-[12px] text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-slate-300 bg-white text-amber-600 focus:ring-amber-400 dark:border-slate-700 dark:bg-slate-950/60 dark:text-amber-400"
              checked={fxPublic()}
              onChange={(e) => setFxPublic(e.currentTarget.checked)}
            />
            <span>Enable public listing</span>
          </label>
        </Field>

        <Show when={createAdvanced()}>
          <>
            <Field
              label={<LabelTip label="Description" content="Optional description for server browser." />}
              error={createFieldErrors().server_description}
            >
              <Input
                value={fxServerDescription()}
                onInput={(e) => setFxServerDescription(e.currentTarget.value)}
                placeholder=""
                invalid={Boolean(createFieldErrors().server_description)}
              />
            </Field>

            <Field label={<LabelTip label="RCON" content="Enable remote console access." />} error={createFieldErrors().rcon_enabled}>
              <label class="inline-flex items-center gap-2 text-[12px] text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  class="h-4 w-4 rounded border-slate-300 bg-white text-amber-600 focus:ring-amber-400 dark:border-slate-700 dark:bg-slate-950/60 dark:text-amber-400"
                  checked={fxRconEnabled()}
                  onChange={(e) => setFxRconEnabled(e.currentTarget.checked)}
                />
                <span>Enable RCON</span>
              </label>
            </Field>

            <Show when={fxRconEnabled()}>
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={<LabelTip label="RCON port" content="RCON TCP port. Use 0 to auto-assign." />} error={createFieldErrors().rcon_port}>
                  <Input
                    ref={(el) => {
                      setCreateFxRconPortEl?.(el)
                    }}
                    type="number"
                    value={fxRconPort()}
                    onInput={(e) => setFxRconPort(e.currentTarget.value)}
                    placeholder="27015"
                    invalid={Boolean(createFieldErrors().rcon_port)}
                  />
                </Field>

                <Field
                  label={<LabelTip label="RCON password" content="Required when RCON is enabled." />}
                  error={createFieldErrors().rcon_password}
                >
                  <Input
                    ref={(el) => {
                      setCreateFxRconPasswordEl?.(el)
                    }}
                    type="password"
                    value={fxRconPassword()}
                    onInput={(e) => setFxRconPassword(e.currentTarget.value)}
                    placeholder="required"
                    invalid={Boolean(createFieldErrors().rcon_password)}
                  />
                </Field>
              </div>
            </Show>
          </>
        </Show>
      </div>
    </Show>
  )
}
