import { Show } from 'solid-js'
import type { I18nTranslate } from '../app/i18n'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { DataBoundary } from '../components/ui/DataBoundary'
import { Input } from '../components/ui/Input'
import { Textarea } from '../components/ui/Textarea'
import { VisibilityToggle } from '../app/primitives/VisibilityToggle'
import { queryClient } from '../rspc'

export type SettingsTabProps = {
  tab: () => string
  t: I18nTranslate
  [key: string]: unknown
}

export default function SettingsTab(props: SettingsTabProps) {
  const {
    tab,
    t,
    settingsStatus,
    me,
    settingsDstKeyVisible,
    settingsDstKey,
    setSettingsDstKey,
    setSettingsDstKeyVisible,
    setDstDefaultKleiKey,
    isReadOnly,
    pushToast,
    toastError,
    settingsCurseforgeKeyVisible,
    settingsCurseforgeKey,
    setSettingsCurseforgeKey,
    setSettingsCurseforgeKeyVisible,
    setCurseforgeApiKey,
    settingsSteamcmdUsername,
    setSettingsSteamcmdUsername,
    settingsSteamcmdPasswordVisible,
    settingsSteamcmdPassword,
    setSettingsSteamcmdPassword,
    setSettingsSteamcmdPasswordVisible,
    settingsSteamcmdGuardCode,
    setSettingsSteamcmdGuardCode,
    settingsSteamcmdMaFile,
    setSettingsSteamcmdMaFile,
    setSteamcmdCredentials,
    settingsCurrentPassword,
    setSettingsCurrentPassword,
    settingsCurrentPasswordVisible,
    setSettingsCurrentPasswordVisible,
    settingsNewUsername,
    setSettingsNewUsername,
    settingsNewPassword,
    setSettingsNewPassword,
    settingsNewPasswordVisible,
    setSettingsNewPasswordVisible,
    changeCredentialsPending,
    handleChangeCredentials,
  } = props as any

  let settingsSteamcmdMaFileInputEl: HTMLInputElement | undefined
  const settingsToastContext = { scope: 'system' as const, label: t('settings.title') }
  const refreshSettings = () => queryClient.invalidateQueries({ queryKey: ['settings.status', null] })

  return (
              <Show when={tab() === 'settings'}>
                <div class="min-h-0 flex-1 overflow-auto p-4">
                  <div class="mx-auto w-full max-w-2xl space-y-4">
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('settings.title')}</div>
                      </div>
                      <Show when={settingsStatus.isPending}>
                        <Badge variant="neutral">{t('settings.loading')}</Badge>
                      </Show>
                    </div>

                    <DataBoundary
                      t={t}
                      loading={settingsStatus.isPending}
                      error={settingsStatus.error}
                      errorTitle={t('settings.errorLoad')}
                      hasData={Boolean(settingsStatus.data)}
                      empty={!me()?.is_admin}
                      emptyTitle={t('settings.forbidden')}
                      onRetry={() => void refreshSettings()}
                    >
                    <Show when={me()?.is_admin}>
                      <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <div class="flex items-center justify-between gap-3">
                          <div class="text-sm font-medium text-slate-900 dark:text-slate-100">{t('settings.controlAccount')}</div>
                          <Badge variant="neutral">{me()?.username ?? t('settings.currentUserFallback')}</Badge>
                        </div>
                        <div class="mt-3 grid gap-2">
                          <Input
                            type={settingsCurrentPasswordVisible() ? 'text' : 'password'}
                            value={settingsCurrentPassword()}
                            onInput={(e) => setSettingsCurrentPassword(e.currentTarget.value)}
                            placeholder={t('settings.currentPasswordPlaceholder')}
                            autocomplete="current-password"
                            class="w-full font-mono text-[11px]"
                            rightIcon={
                              <VisibilityToggle
                                visible={settingsCurrentPasswordVisible()}
                                labelWhenHidden={t('settings.showPassword')}
                                labelWhenVisible={t('settings.hidePassword')}
                                onToggle={() => setSettingsCurrentPasswordVisible((v: boolean) => !v)}
                              />
                            }
                          />

                          <Input
                            value={settingsNewUsername()}
                            onInput={(e) => setSettingsNewUsername(e.currentTarget.value)}
                            placeholder={t('settings.newUsernamePlaceholder', { current: me()?.username ?? 'admin' })}
                            autocomplete="username"
                            spellcheck={false}
                            class="font-mono text-[11px]"
                          />

                          <Input
                            type={settingsNewPasswordVisible() ? 'text' : 'password'}
                            value={settingsNewPassword()}
                            onInput={(e) => setSettingsNewPassword(e.currentTarget.value)}
                            placeholder={t('settings.newPasswordPlaceholder')}
                            autocomplete="new-password"
                            class="w-full font-mono text-[11px]"
                            rightIcon={
                              <VisibilityToggle
                                visible={settingsNewPasswordVisible()}
                                labelWhenHidden={t('settings.showPassword')}
                                labelWhenVisible={t('settings.hidePassword')}
                                onToggle={() => setSettingsNewPasswordVisible((v: boolean) => !v)}
                              />
                            }
                          />
                        </div>

                        <div class="mt-3 flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="primary"
                            loading={changeCredentialsPending()}
                            disabled={isReadOnly()}
                            onClick={async () => {
                              await handleChangeCredentials()
                            }}
                          >
                            {t('settings.saveAccount')}
                          </Button>
                        </div>
                      </div>

                      <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <div class="flex items-center justify-between gap-3">
                          <div class="text-sm font-medium text-slate-900 dark:text-slate-100">{t('settings.dstDefaultKleiKey')}</div>
                          <Badge variant={settingsStatus.data?.dst_default_klei_key_set ? 'success' : 'warning'}>
                            {settingsStatus.data?.dst_default_klei_key_set ? t('settings.configured') : t('settings.notSet')}
                          </Badge>
                        </div>
                        <div class="mt-3">
                          <Input
                            type={settingsDstKeyVisible() ? 'text' : 'password'}
                            value={settingsDstKey()}
                            onInput={(e) => setSettingsDstKey(e.currentTarget.value)}
                            placeholder={t('settings.pasteKeyPlaceholder')}
                            spellcheck={false}
                            class="w-full font-mono text-[11px]"
                            rightIcon={
                              <VisibilityToggle
                                visible={settingsDstKeyVisible()}
                                labelWhenHidden={t('settings.showKey')}
                                labelWhenVisible={t('settings.hideKey')}
                                onToggle={() => setSettingsDstKeyVisible((v: boolean) => !v)}
                              />
                            }
                          />
                        </div>

                        <div class="mt-3 flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="primary"
                            loading={setDstDefaultKleiKey.isPending}
                            disabled={isReadOnly()}
                            onClick={async () => {
                              try {
                                await setDstDefaultKleiKey.mutateAsync({ key: settingsDstKey() })
                                setSettingsDstKey('')
                                void refreshSettings()
                                pushToast('success', t('settings.saved'), t('settings.dstDefaultKeyUpdated'), undefined, {
                                  context: settingsToastContext,
                                })
                              } catch (e) {
                                toastError(t('settings.saveFailed'), e, {
                                  context: settingsToastContext,
                                })
                              }
                            }}
                          >
                            {t('settings.save')}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={isReadOnly()}
                            onClick={async () => {
                              try {
                                await setDstDefaultKleiKey.mutateAsync({ key: '' })
                                setSettingsDstKey('')
                                void refreshSettings()
                                pushToast('success', t('settings.cleared'), t('settings.dstDefaultKeyCleared'), undefined, {
                                  context: settingsToastContext,
                                })
                              } catch (e) {
                                toastError(t('settings.clearFailed'), e, {
                                  context: settingsToastContext,
                                })
                              }
                            }}
                          >
                            {t('settings.clear')}
                          </Button>
                        </div>
                      </div>

                      <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <div class="flex items-center justify-between gap-3">
                          <div class="text-sm font-medium text-slate-900 dark:text-slate-100">{t('settings.curseforgeApiKey')}</div>
                          <Badge variant={settingsStatus.data?.curseforge_api_key_set ? 'success' : 'warning'}>
                            {settingsStatus.data?.curseforge_api_key_set ? t('settings.configured') : t('settings.notSet')}
                          </Badge>
                        </div>
                        <div class="mt-3">
                          <Input
                            type={settingsCurseforgeKeyVisible() ? 'text' : 'password'}
                            value={settingsCurseforgeKey()}
                            onInput={(e) => setSettingsCurseforgeKey(e.currentTarget.value)}
                            placeholder={t('settings.pasteKeyPlaceholder')}
                            spellcheck={false}
                            class="w-full font-mono text-[11px]"
                            rightIcon={
                              <VisibilityToggle
                                visible={settingsCurseforgeKeyVisible()}
                                labelWhenHidden={t('settings.showKey')}
                                labelWhenVisible={t('settings.hideKey')}
                                onToggle={() => setSettingsCurseforgeKeyVisible((v: boolean) => !v)}
                              />
                            }
                          />
                        </div>

                        <div class="mt-3 flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="primary"
                            loading={setCurseforgeApiKey.isPending}
                            disabled={isReadOnly()}
                            onClick={async () => {
                              try {
                                await setCurseforgeApiKey.mutateAsync({ key: settingsCurseforgeKey() })
                                setSettingsCurseforgeKey('')
                                void refreshSettings()
                                pushToast('success', t('settings.saved'), t('settings.curseforgeUpdated'), undefined, {
                                  context: settingsToastContext,
                                })
                              } catch (e) {
                                toastError(t('settings.saveFailed'), e, {
                                  context: settingsToastContext,
                                })
                              }
                            }}
                          >
                            {t('settings.save')}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={isReadOnly()}
                            onClick={async () => {
                              try {
                                await setCurseforgeApiKey.mutateAsync({ key: '' })
                                setSettingsCurseforgeKey('')
                                void refreshSettings()
                                pushToast('success', t('settings.cleared'), t('settings.curseforgeCleared'), undefined, {
                                  context: settingsToastContext,
                                })
                              } catch (e) {
                                toastError(t('settings.clearFailed'), e, {
                                  context: settingsToastContext,
                                })
                              }
                            }}
                          >
                            {t('settings.clear')}
                          </Button>
                        </div>
                      </div>

                      <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <div class="flex items-center justify-between gap-3">
                          <div class="text-sm font-medium text-slate-900 dark:text-slate-100">{t('settings.steamcmdCredentials')}</div>
                          <Badge variant={settingsStatus.data?.steamcmd_username_set && settingsStatus.data?.steamcmd_password_set ? 'success' : 'warning'}>
                            {settingsStatus.data?.steamcmd_username_set && settingsStatus.data?.steamcmd_password_set ? t('settings.configured') : t('settings.notSet')}
                          </Badge>
                        </div>
                        <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                          <Badge variant={settingsStatus.data?.steamcmd_shared_secret_set ? 'success' : 'neutral'}>
                            {settingsStatus.data?.steamcmd_shared_secret_set ? t('settings.auto2faEnabled') : t('settings.auto2faDisabled')}
                          </Badge>
                          <Show when={settingsStatus.data?.steamcmd_account_name}>
                            {(name) => (
                              <Badge variant="neutral">
                                {t('settings.accountBadge', { name: name() })}
                              </Badge>
                            )}
                          </Show>
                        </div>

                        <div class="mt-3 grid gap-2">
                          <Input
                            value={settingsSteamcmdUsername()}
                            onInput={(e) => setSettingsSteamcmdUsername(e.currentTarget.value)}
                            placeholder={t('settings.steamUsernamePlaceholder')}
                            autocomplete="username"
                            spellcheck={false}
                            class="font-mono text-[11px]"
                          />

                          <Input
                            type={settingsSteamcmdPasswordVisible() ? 'text' : 'password'}
                            value={settingsSteamcmdPassword()}
                            onInput={(e) => setSettingsSteamcmdPassword(e.currentTarget.value)}
                            placeholder={t('settings.steamPasswordPlaceholder')}
                            autocomplete="current-password"
                            class="w-full font-mono text-[11px]"
                            rightIcon={
                              <VisibilityToggle
                                visible={settingsSteamcmdPasswordVisible()}
                                labelWhenHidden={t('settings.showPassword')}
                                labelWhenVisible={t('settings.hidePassword')}
                                onToggle={() => setSettingsSteamcmdPasswordVisible((v: boolean) => !v)}
                              />
                            }
                          />

                          <Input
                            value={settingsSteamcmdGuardCode()}
                            onInput={(e) => setSettingsSteamcmdGuardCode(e.currentTarget.value)}
                            placeholder={t('settings.steamGuardCodePlaceholder')}
                            autocomplete="one-time-code"
                            class="font-mono text-[11px]"
                          />

                          <Textarea
                            value={settingsSteamcmdMaFile()}
                            onInput={(e) => setSettingsSteamcmdMaFile(e.currentTarget.value)}
                            placeholder={t('settings.mafileJsonPlaceholder')}
                            class="min-h-[96px] font-mono text-[11px]"
                          />

                          <div class="flex flex-wrap items-center gap-2">
                            <input
                              ref={(el) => {
                                settingsSteamcmdMaFileInputEl = el
                              }}
                              type="file"
                              accept=".json,application/json"
                              class="hidden"
                              onChange={async (e) => {
                                const file = e.currentTarget.files?.[0]
                                if (!file) return
                                try {
                                  const text = await file.text()
                                  setSettingsSteamcmdMaFile(text)
                                  pushToast('success', t('settings.mafileImported'), file.name, undefined, {
                                    context: settingsToastContext,
                                  })
                                } catch {
                                  pushToast('error', t('settings.importFailed'), t('settings.couldNotReadMafile'), undefined, {
                                    context: settingsToastContext,
                                  })
                                } finally {
                                  e.currentTarget.value = ''
                                }
                              }}
                            />
                            <Button
                              size="xs"
                              variant="secondary"
                              type="button"
                              onClick={() => settingsSteamcmdMaFileInputEl?.click()}
                            >
                              {t('settings.importMafile')}
                            </Button>
                            <Show when={settingsSteamcmdMaFile().trim().length > 0}>
                              <Button
                                size="xs"
                                variant="secondary"
                                onClick={() => setSettingsSteamcmdMaFile('')}
                              >
                                {t('settings.clearMafile')}
                              </Button>
                            </Show>
                          </div>
                        </div>

                        <div class="mt-3 flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="primary"
                            loading={setSteamcmdCredentials.isPending}
                            disabled={isReadOnly()}
                            onClick={async () => {
                              const username = settingsSteamcmdUsername().trim()
                              const password = settingsSteamcmdPassword()
                              const steam_guard_code = settingsSteamcmdGuardCode().trim()
                              const mafile_json = settingsSteamcmdMaFile().trim()
                              if ((username && !password) || (!username && password)) {
                                pushToast('error', t('settings.missingField'), t('settings.enterSteamUsernameAndPassword'), undefined, {
                                  context: settingsToastContext,
                                })
                                return
                              }
                              try {
                                await setSteamcmdCredentials.mutateAsync({
                                  username,
                                  password,
                                  steam_guard_code: steam_guard_code || null,
                                  shared_secret: null,
                                  mafile_json: mafile_json || null,
                                })
                                setSettingsSteamcmdUsername('')
                                setSettingsSteamcmdPassword('')
                                setSettingsSteamcmdGuardCode('')
                                setSettingsSteamcmdMaFile('')
                                void refreshSettings()
                                pushToast('success', t('settings.loginSuccessful'), t('settings.steamCredentialsSaved'), undefined, {
                                  context: settingsToastContext,
                                })
                              } catch (e) {
                                toastError(t('settings.loginFailed'), e, {
                                  context: settingsToastContext,
                                })
                              }
                            }}
                          >
                            {t('settings.login')}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={isReadOnly()}
                            onClick={async () => {
                              try {
                                await setSteamcmdCredentials.mutateAsync({
                                  username: '',
                                  password: '',
                                  steam_guard_code: null,
                                  shared_secret: null,
                                  mafile_json: null,
                                })
                                setSettingsSteamcmdUsername('')
                                setSettingsSteamcmdPassword('')
                                setSettingsSteamcmdGuardCode('')
                                setSettingsSteamcmdMaFile('')
                                void refreshSettings()
                                pushToast('success', t('settings.cleared'), t('settings.steamCredentialsCleared'), undefined, {
                                  context: settingsToastContext,
                                })
                              } catch (e) {
                                toastError(t('settings.clearFailed'), e, {
                                  context: settingsToastContext,
                                })
                              }
                            }}
                          >
                            {t('settings.clear')}
                          </Button>
                        </div>
                      </div>

                    </Show>
                    </DataBoundary>
                  </div>
                </div>
              </Show>

  )
}
