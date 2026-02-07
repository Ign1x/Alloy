import { Show } from 'solid-js'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { Input } from '../components/ui/Input'
import { Textarea } from '../components/ui/Textarea'
import { VisibilityToggle } from '../app/primitives/VisibilityToggle'
import { safeCopy } from '../app/helpers/misc'
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
    updateCheck,
    triggerUpdate,
    controlDiagnostics,
  } = props as any

  let settingsSteamcmdMaFileInputEl: HTMLInputElement | undefined

  return (
              <Show when={tab() === 'settings'}>
                <div class="min-h-0 flex-1 overflow-auto p-4">
                  <div class="mx-auto w-full max-w-2xl space-y-4">
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">Settings</div>
                        <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Configure shared secrets used by templates.
                        </div>
                      </div>
                      <Show when={settingsStatus.isPending}>
                        <Badge variant="neutral">Loading</Badge>
                      </Show>
                    </div>

                    <Show
                      when={me()?.is_admin}
                      fallback={<EmptyState title="Forbidden" description="Administrator access required." />}
                    >
                      <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <div class="flex items-center justify-between gap-3">
                          <div class="text-sm font-medium text-slate-900 dark:text-slate-100">DST default Klei key</div>
                          <Badge variant={settingsStatus.data?.dst_default_klei_key_set ? 'success' : 'warning'}>
                            {settingsStatus.data?.dst_default_klei_key_set ? 'Configured' : 'Not set'}
                          </Badge>
                        </div>
                        <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Used as the default <span class="font-mono">cluster_token</span> when creating DST instances (if left blank).
                        </div>

                        <div class="mt-3">
                          <Input
                            type={settingsDstKeyVisible() ? 'text' : 'password'}
                            value={settingsDstKey()}
                            onInput={(e) => setSettingsDstKey(e.currentTarget.value)}
                            placeholder={settingsStatus.data?.dst_default_klei_key_set ? '(configured — paste to update, blank to clear)' : 'Paste key…'}
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
                        <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Required for resolving CurseForge modpacks and downloading the author-provided server pack.
                        </div>

                        <div class="mt-3">
                          <Input
                            type={settingsCurseforgeKeyVisible() ? 'text' : 'password'}
                            value={settingsCurseforgeKey()}
                            onInput={(e) => setSettingsCurseforgeKey(e.currentTarget.value)}
                            placeholder={settingsStatus.data?.curseforge_api_key_set ? '(configured — paste to update, blank to clear)' : 'Paste key…'}
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
                        <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Shared by SteamCMD-based templates. Supports `maFile` import and automatic Steam Guard (2FA).
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
                            placeholder={
                              settingsStatus.data?.steamcmd_username_set
                                ? '(configured — paste to update, blank + clear to remove)'
                                : 'Steam username…'
                            }
                            autocomplete="username"
                            spellcheck={false}
                            class="font-mono text-[11px]"
                          />

                          <Input
                            type={settingsSteamcmdPasswordVisible() ? 'text' : 'password'}
                            value={settingsSteamcmdPassword()}
                            onInput={(e) => setSettingsSteamcmdPassword(e.currentTarget.value)}
                            placeholder={
                              settingsStatus.data?.steamcmd_password_set
                                ? '(configured — paste to update, blank + clear to remove)'
                                : 'Steam password…'
                            }
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
                            placeholder="Steam Guard code (optional, usually not needed with maFile)…"
                            autocomplete="one-time-code"
                            class="font-mono text-[11px]"
                          />

                          <Textarea
                            value={settingsSteamcmdMaFile()}
                            onInput={(e) => setSettingsSteamcmdMaFile(e.currentTarget.value)}
                            placeholder="Paste Steam Desktop Authenticator maFile JSON here (optional)…"
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

                      <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <div class="flex flex-wrap items-start justify-between gap-3">
                          <div class="min-w-0">
                            <div class="text-sm font-medium text-slate-900 dark:text-slate-100">Updates</div>
                            <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              Current <span class="font-mono">{controlDiagnostics.data?.control_version ?? '—'}</span>
                              <Show when={updateCheck.data?.latest}>
                                {(latest) => (
                                  <>
                                    {' '}
                                    · Latest{' '}
                                    <a
                                      href={latest().url}
                                      target="_blank"
                                      rel="noreferrer"
                                      class="font-mono text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500 dark:text-slate-100 dark:decoration-slate-700 dark:hover:decoration-slate-500"
                                    >
                                      {latest().tag}
                                    </a>
                                  </>
                                )}
                              </Show>
                            </div>
                          </div>
                          <div class="flex flex-wrap items-center gap-2">
                            <Show when={updateCheck.isPending}>
                              <Badge variant="neutral">Checking</Badge>
                            </Show>
                            <Show when={updateCheck.data && !updateCheck.isPending && !updateCheck.isError}>
                              <Badge variant={updateCheck.data?.update_available ? 'warning' : 'success'}>
                                {updateCheck.data?.update_available ? 'Update available' : 'Up to date'}
                              </Badge>
                            </Show>
                          </div>
                        </div>

                        <Show when={updateCheck.data?.latest?.published_at}>
                          {(publishedAt) => (
                            <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                              Published <span class="font-mono">{publishedAt()}</span>
                            </div>
                          )}
                        </Show>

                        <Show when={updateCheck.data?.latest?.body}>
                          {(body) => (
                            <pre class="mt-3 max-h-56 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200">
                              {body()}
                            </pre>
                          )}
                        </Show>

                        <Show when={updateCheck.isError}>
                          <ErrorState title="Failed to check updates" error={updateCheck.error} onRetry={() => updateCheck.refetch()} class="mt-3" />
                        </Show>

                        <div class="mt-3 flex flex-wrap items-center gap-2">
                          <Button size="sm" variant="secondary" disabled={updateCheck.isPending} onClick={() => updateCheck.refetch()}>
                            Check
                          </Button>
                          <Button
                            size="sm"
                            variant="primary"
                            loading={triggerUpdate.isPending}
                            disabled={
                              isReadOnly() ||
                              triggerUpdate.isPending ||
                              updateCheck.isPending ||
                              !updateCheck.data?.can_trigger_update ||
                              !updateCheck.data?.update_available
                            }
                            title={
                              isReadOnly()
                                ? 'Read-only mode'
                                : !updateCheck.data?.can_trigger_update
                                  ? 'Updater not configured'
                                  : !updateCheck.data?.update_available
                                    ? 'Already up to date'
                                    : 'Trigger update'
                            }
                            onClick={async () => {
                              try {
                                const out = await triggerUpdate.mutateAsync(null)
                                pushToast('success', 'Update triggered', out.message || 'Watchtower update requested.')
                                setTimeout(() => {
                                  try {
                                    window.location.reload()
                                  } catch {
                                    // ignore
                                  }
                                }, 3000)
                              } catch (e) {
                                toastError('Update failed', e)
                              }
                            }}
                          >
                            Update now
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={async () => {
                              const cmd = 'docker compose pull && docker compose up -d'
                              try {
                                await safeCopy(cmd)
                                pushToast('success', 'Copied', cmd)
                              } catch (e) {
                                toastError('Copy failed', e)
                              }
                            }}
                          >
                            Copy docker command
                          </Button>
                        </div>

                        <div class="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200">
                          docker compose pull && docker compose up -d
                        </div>

                        <Show when={updateCheck.data && !updateCheck.data.can_trigger_update}>
                          <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                            One-click update requires Watchtower HTTP API. Set{' '}
                            <span class="font-mono">ALLOY_UPDATE_WATCHTOWER_URL</span> and{' '}
                            <span class="font-mono">ALLOY_UPDATE_WATCHTOWER_TOKEN</span> on{' '}
                            <span class="font-mono">alloy-control</span>.
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </div>
              </Show>

  )
}
