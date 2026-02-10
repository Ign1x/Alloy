import { Show } from 'solid-js'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Input } from '../components/ui/Input'
import { Textarea } from '../components/ui/Textarea'
import { VisibilityToggle } from '../app/primitives/VisibilityToggle'
import { queryClient } from '../rspc'

export type SettingsTabProps = {
  tab: () => string
  [key: string]: unknown
}

export default function SettingsTab(props: SettingsTabProps) {
  const {
    tab,
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

  return (
              <Show when={tab() === 'settings'}>
                <div class="min-h-0 flex-1 overflow-auto p-4">
                  <div class="mx-auto w-full max-w-2xl space-y-4">
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">Settings</div>
                      </div>
                      <Show when={settingsStatus.isPending}>
                        <Badge variant="neutral">Loading</Badge>
                      </Show>
                    </div>

                    <Show when={me()?.is_admin} fallback={<EmptyState title="Forbidden" />}>
                      <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <div class="flex items-center justify-between gap-3">
                          <div class="text-sm font-medium text-slate-900 dark:text-slate-100">Control account</div>
                          <Badge variant="neutral">{me()?.username ?? 'current user'}</Badge>
                        </div>
                        <div class="mt-3 grid gap-2">
                          <Input
                            type={settingsCurrentPasswordVisible() ? 'text' : 'password'}
                            value={settingsCurrentPassword()}
                            onInput={(e) => setSettingsCurrentPassword(e.currentTarget.value)}
                            placeholder="Current password…"
                            autocomplete="current-password"
                            class="w-full font-mono text-[11px]"
                            rightIcon={
                              <VisibilityToggle
                                visible={settingsCurrentPasswordVisible()}
                                labelWhenHidden="Show password"
                                labelWhenVisible="Hide password"
                                onToggle={() => setSettingsCurrentPasswordVisible((v: boolean) => !v)}
                              />
                            }
                          />

                          <Input
                            value={settingsNewUsername()}
                            onInput={(e) => setSettingsNewUsername(e.currentTarget.value)}
                            placeholder={`New username… (current: ${me()?.username ?? 'admin'})`}
                            autocomplete="username"
                            spellcheck={false}
                            class="font-mono text-[11px]"
                          />

                          <Input
                            type={settingsNewPasswordVisible() ? 'text' : 'password'}
                            value={settingsNewPassword()}
                            onInput={(e) => setSettingsNewPassword(e.currentTarget.value)}
                            placeholder="New password…"
                            autocomplete="new-password"
                            class="w-full font-mono text-[11px]"
                            rightIcon={
                              <VisibilityToggle
                                visible={settingsNewPasswordVisible()}
                                labelWhenHidden="Show password"
                                labelWhenVisible="Hide password"
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
                            Save account
                          </Button>
                        </div>
                      </div>

                      <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <div class="flex items-center justify-between gap-3">
                          <div class="text-sm font-medium text-slate-900 dark:text-slate-100">DST default Klei key</div>
                          <Badge variant={settingsStatus.data?.dst_default_klei_key_set ? 'success' : 'warning'}>
                            {settingsStatus.data?.dst_default_klei_key_set ? 'Configured' : 'Not set'}
                          </Badge>
                        </div>
                        <div class="mt-3">
                          <Input
                            type={settingsDstKeyVisible() ? 'text' : 'password'}
                            value={settingsDstKey()}
                            onInput={(e) => setSettingsDstKey(e.currentTarget.value)}
                            placeholder="Paste key…"
                            spellcheck={false}
                            class="w-full font-mono text-[11px]"
                            rightIcon={
                              <VisibilityToggle
                                visible={settingsDstKeyVisible()}
                                labelWhenHidden="Show key"
                                labelWhenVisible="Hide key"
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
                                void queryClient.invalidateQueries({ queryKey: ['settings.status', null] })
                                pushToast('success', 'Saved', 'DST default key updated')
                              } catch (e) {
                                toastError('Save failed', e)
                              }
                            }}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={isReadOnly()}
                            onClick={async () => {
                              try {
                                await setDstDefaultKleiKey.mutateAsync({ key: '' })
                                setSettingsDstKey('')
                                void queryClient.invalidateQueries({ queryKey: ['settings.status', null] })
                                pushToast('success', 'Cleared', 'DST default key cleared')
                              } catch (e) {
                                toastError('Clear failed', e)
                              }
                            }}
                          >
                            Clear
                          </Button>
                        </div>
                      </div>

                      <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <div class="flex items-center justify-between gap-3">
                          <div class="text-sm font-medium text-slate-900 dark:text-slate-100">CurseForge API key</div>
                          <Badge variant={settingsStatus.data?.curseforge_api_key_set ? 'success' : 'warning'}>
                            {settingsStatus.data?.curseforge_api_key_set ? 'Configured' : 'Not set'}
                          </Badge>
                        </div>
                        <div class="mt-3">
                          <Input
                            type={settingsCurseforgeKeyVisible() ? 'text' : 'password'}
                            value={settingsCurseforgeKey()}
                            onInput={(e) => setSettingsCurseforgeKey(e.currentTarget.value)}
                            placeholder="Paste key…"
                            spellcheck={false}
                            class="w-full font-mono text-[11px]"
                            rightIcon={
                              <VisibilityToggle
                                visible={settingsCurseforgeKeyVisible()}
                                labelWhenHidden="Show key"
                                labelWhenVisible="Hide key"
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
                                void queryClient.invalidateQueries({ queryKey: ['settings.status', null] })
                                pushToast('success', 'Saved', 'CurseForge API key updated')
                              } catch (e) {
                                toastError('Save failed', e)
                              }
                            }}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={isReadOnly()}
                            onClick={async () => {
                              try {
                                await setCurseforgeApiKey.mutateAsync({ key: '' })
                                setSettingsCurseforgeKey('')
                                void queryClient.invalidateQueries({ queryKey: ['settings.status', null] })
                                pushToast('success', 'Cleared', 'CurseForge API key cleared')
                              } catch (e) {
                                toastError('Clear failed', e)
                              }
                            }}
                          >
                            Clear
                          </Button>
                        </div>
                      </div>

                      <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <div class="flex items-center justify-between gap-3">
                          <div class="text-sm font-medium text-slate-900 dark:text-slate-100">SteamCMD credentials</div>
                          <Badge variant={settingsStatus.data?.steamcmd_username_set && settingsStatus.data?.steamcmd_password_set ? 'success' : 'warning'}>
                            {settingsStatus.data?.steamcmd_username_set && settingsStatus.data?.steamcmd_password_set ? 'Configured' : 'Not set'}
                          </Badge>
                        </div>
                        <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                          <Badge variant={settingsStatus.data?.steamcmd_shared_secret_set ? 'success' : 'neutral'}>
                            {settingsStatus.data?.steamcmd_shared_secret_set ? 'Auto 2FA enabled' : 'Auto 2FA disabled'}
                          </Badge>
                          <Show when={settingsStatus.data?.steamcmd_account_name}>
                            {(name) => (
                              <Badge variant="neutral">
                                Account {name()}
                              </Badge>
                            )}
                          </Show>
                        </div>

                        <div class="mt-3 grid gap-2">
                          <Input
                            value={settingsSteamcmdUsername()}
                            onInput={(e) => setSettingsSteamcmdUsername(e.currentTarget.value)}
                            placeholder="Steam username…"
                            autocomplete="username"
                            spellcheck={false}
                            class="font-mono text-[11px]"
                          />

                          <Input
                            type={settingsSteamcmdPasswordVisible() ? 'text' : 'password'}
                            value={settingsSteamcmdPassword()}
                            onInput={(e) => setSettingsSteamcmdPassword(e.currentTarget.value)}
                            placeholder="Steam password…"
                            autocomplete="current-password"
                            class="w-full font-mono text-[11px]"
                            rightIcon={
                              <VisibilityToggle
                                visible={settingsSteamcmdPasswordVisible()}
                                labelWhenHidden="Show password"
                                labelWhenVisible="Hide password"
                                onToggle={() => setSettingsSteamcmdPasswordVisible((v: boolean) => !v)}
                              />
                            }
                          />

                          <Input
                            value={settingsSteamcmdGuardCode()}
                            onInput={(e) => setSettingsSteamcmdGuardCode(e.currentTarget.value)}
                            placeholder="Steam Guard code…"
                            autocomplete="one-time-code"
                            class="font-mono text-[11px]"
                          />

                          <Textarea
                            value={settingsSteamcmdMaFile()}
                            onInput={(e) => setSettingsSteamcmdMaFile(e.currentTarget.value)}
                            placeholder="maFile JSON…"
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
                                  pushToast('success', 'maFile imported', file.name)
                                } catch {
                                  pushToast('error', 'Import failed', 'Could not read maFile')
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
                              Import maFile
                            </Button>
                            <Show when={settingsSteamcmdMaFile().trim().length > 0}>
                              <Button
                                size="xs"
                                variant="secondary"
                                onClick={() => setSettingsSteamcmdMaFile('')}
                              >
                                Clear maFile
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
                                pushToast('error', 'Missing field', 'Enter both Steam username and password, or clear both.')
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
                                void queryClient.invalidateQueries({ queryKey: ['settings.status', null] })
                                pushToast('success', 'Login successful', 'SteamCMD credentials verified and saved')
                              } catch (e) {
                                toastError('Login failed', e)
                              }
                            }}
                          >
                            Login
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
                                void queryClient.invalidateQueries({ queryKey: ['settings.status', null] })
                                pushToast('success', 'Cleared', 'SteamCMD credentials cleared')
                              } catch (e) {
                                toastError('Clear failed', e)
                              }
                            }}
                          >
                            Clear
                          </Button>
                        </div>
                      </div>

                    </Show>
                  </div>
                </div>
              </Show>

  )
}
