import { Show } from 'solid-js'
import { LabelTip } from '../../app/primitives/LabelTip'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { Input } from '../../components/ui/Input'

export type PalworldCreateSectionProps = {
  [key: string]: unknown
}

export default function PalworldCreateSection(props: PalworldCreateSectionProps) {
  const {
    t,
    selectedTemplate,
    createAdvanced,
    setCreateAdvanced,
    createAdvancedDirty,
    createFieldErrors,
    setCreatePwPortEl,
    pwServerName,
    setPwServerName,
    pwMaxPlayers,
    setPwMaxPlayers,
    pwPublic,
    setPwPublic,
    pwServerDescription,
    setPwServerDescription,
    pwPassword,
    setPwPassword,
    pwAdminPassword,
    setPwAdminPassword,
    pwPort,
    setPwPort,
    setCreatePwQueryPortEl,
    pwQueryPort,
    setPwQueryPort,
  } = props as any

  return (
    <Show when={selectedTemplate() === 'palworld:vanilla'}>
      <div class="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
        <div class="flex items-center justify-between gap-3">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t('instancesCreate.section.palworld')}
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

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label={<LabelTip label={t('instancesCreate.common.serverNameLabel')} content={t('instancesCreate.palworld.serverNameHint')} />}
            error={createFieldErrors().server_name}
          >
            <Input
              value={pwServerName()}
              onInput={(e) => setPwServerName(e.currentTarget.value)}
              placeholder={t('instancesCreate.palworld.defaultServerNamePlaceholder')}
              invalid={Boolean(createFieldErrors().server_name)}
            />
          </Field>

          <Field
            label={<LabelTip label={t('instancesCreate.common.maxPlayersLabel')} content={t('instancesCreate.palworld.maxPlayersHint')} />}
            error={createFieldErrors().max_players}
          >
            <Input
              type="number"
              value={pwMaxPlayers()}
              onInput={(e) => setPwMaxPlayers(e.currentTarget.value)}
              placeholder="32"
              invalid={Boolean(createFieldErrors().max_players)}
            />
          </Field>
        </div>

        <Field
          label={<LabelTip label={t('instancesCreate.common.publicListingLabel')} content={t('instancesCreate.palworld.publicListingHint')} />}
          error={createFieldErrors().public}
        >
          <label class="inline-flex items-center gap-2 text-[12px] text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-slate-300 bg-white text-amber-600 focus:ring-amber-400 dark:border-slate-700 dark:bg-slate-950/60 dark:text-amber-400"
              checked={pwPublic()}
              onChange={(e) => setPwPublic(e.currentTarget.checked)}
            />
            <span>{t('instancesCreate.enablePublicListing')}</span>
          </label>
        </Field>

        <Show when={createAdvanced()}>
          <>
            <Field
              label={<LabelTip label={t('instancesCreate.common.descriptionLabel')} content={t('instancesCreate.palworld.descriptionHint')} />}
              error={createFieldErrors().server_description}
            >
              <Input
                value={pwServerDescription()}
                onInput={(e) => setPwServerDescription(e.currentTarget.value)}
                placeholder={t('instancesCreate.common.descriptionPlaceholder')}
                invalid={Boolean(createFieldErrors().server_description)}
              />
            </Field>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label={<LabelTip label={t('instancesCreate.common.passwordLabel')} content={t('instancesCreate.common.passwordOptionalHint')} />}
                error={createFieldErrors().password}
              >
                <Input
                  type="password"
                  value={pwPassword()}
                  onInput={(e) => setPwPassword(e.currentTarget.value)}
                  placeholder="(none)"
                  invalid={Boolean(createFieldErrors().password)}
                />
              </Field>

              <Field
                label={<LabelTip label={t('instancesCreate.palworld.adminPasswordLabel')} content={t('instancesCreate.palworld.adminPasswordHint')} />}
                error={createFieldErrors().admin_password}
              >
                <Input
                  type="password"
                  value={pwAdminPassword()}
                  onInput={(e) => setPwAdminPassword(e.currentTarget.value)}
                  placeholder="(none)"
                  invalid={Boolean(createFieldErrors().admin_password)}
                />
              </Field>
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label={<LabelTip label={t('instancesCreate.common.portUdpLabel')} content={t('instancesCreate.palworld.portUdpHint')} />}
                error={createFieldErrors().port}
              >
                <Input
                  ref={(el) => {
                    setCreatePwPortEl?.(el)
                  }}
                  type="number"
                  value={pwPort()}
                  onInput={(e) => setPwPort(e.currentTarget.value)}
                  placeholder="8211"
                  invalid={Boolean(createFieldErrors().port)}
                />
              </Field>

              <Field
                label={<LabelTip label={t('instancesCreate.palworld.queryPortUdpLabel')} content={t('instancesCreate.palworld.queryPortUdpHint')} />}
                error={createFieldErrors().query_port}
              >
                <Input
                  ref={(el) => {
                    setCreatePwQueryPortEl?.(el)
                  }}
                  type="number"
                  value={pwQueryPort()}
                  onInput={(e) => setPwQueryPort(e.currentTarget.value)}
                  placeholder="27015"
                  invalid={Boolean(createFieldErrors().query_port)}
                />
              </Field>
            </div>
          </>
        </Show>
      </div>
    </Show>
  )
}
