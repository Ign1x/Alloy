import { Bell, Check, ChevronDown, Languages, Moon, Monitor, Sun } from 'lucide-solid'
import { For, Show, createEffect, createMemo, createSignal, type Setter } from 'solid-js'
import { Portal } from 'solid-js/web'

import type { AppLocale, I18nTranslate } from '../app/i18n'
import type { ToastPushOptions } from '../app/types'
import type { ThemePreference } from '../app/hooks/useThemePreference'
import { StatusPill } from '../app/primitives/StatusPill'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { ensureCsrfCookie } from '../auth'
import { formatDateTime } from '../app/helpers/format'

type AuthUser = { username: string; is_admin: boolean } | null

type LatestRelease = {
  tag: string
  version?: string | null
  url: string
  published_at?: string | null
  body?: string | null
}

type UpdateCheckData = {
  update_available?: boolean
  can_trigger_update?: boolean
  latest?: LatestRelease | null
  agent_latest?: LatestRelease | null
  compatibility?: {
    control_min_agent?: string | null
    control_max_agent?: string | null
    note?: string | null
  } | null
  source?: {
    kind?: string | null
    channel?: string | null
    manifest_url?: string | null
    warning?: string | null
  } | null
  fetched_at_unix_ms?: string | null
}

type UpdateCheckQuery = {
  isPending: boolean
  isError: boolean
  error: unknown
  data?: UpdateCheckData | null
  refetch: () => Promise<unknown> | unknown
}

type TriggerUpdateMutation = {
  isPending: boolean
  mutateAsync: (input: null) => Promise<{ message?: string | null }>
}

interface AppTopHeaderProps {
  setMobileNavOpen: Setter<boolean>
  backendPending: boolean
  backendError: boolean
  isReadOnly: boolean
  themeButtonTitle: string
  themePref: ThemePreference
  setThemePref: Setter<ThemePreference>
  authLoading: boolean
  me: AuthUser
  locale: AppLocale
  setLocale: (locale: AppLocale) => void
  localeOptions: ReadonlyArray<{ value: AppLocale; label: string; shortLabel: string }>
  localeShort: string
  t: I18nTranslate
  openLoginModal: () => void
  showAccountMenu: boolean
  setShowAccountMenu: Setter<boolean>
  showUpdateCenter: boolean
  setShowUpdateCenter: Setter<boolean>
  updateCheck: UpdateCheckQuery
  triggerUpdate: TriggerUpdateMutation
  controlVersion: string | null
  agentOutdatedCount: number
  agentNodeCount: number
  openNodesTab: () => void
  openSettingsTab: () => void
  eventUnreadCount: number
  openEventCenter: () => void
  pushToast: (variant: 'info' | 'success' | 'error', title: string, message?: string, requestId?: string, options?: ToastPushOptions) => void
  toastError: (title: string, error: unknown, options?: ToastPushOptions) => void
  openDiagnostics: () => void
  handleLogout: () => Promise<void>
}

export default function AppTopHeader(props: AppTopHeaderProps) {
  const [showLanguageMenu, setShowLanguageMenu] = createSignal(false)
  const [controlUpdateSubmitting, setControlUpdateSubmitting] = createSignal(false)
  const [checkNowSubmitting, setCheckNowSubmitting] = createSignal(false)
  const [checkNowAtUnixMs, setCheckNowAtUnixMs] = createSignal<string | null>(null)
  let languageMenuRoot: HTMLDivElement | undefined

  const hasControlUpdate = () => Boolean(props.updateCheck.data?.update_available)
  const hasAgentUpdate = () => props.agentOutdatedCount > 0
  const hasAnyUpdate = () => hasControlUpdate() || hasAgentUpdate()
  const effectiveFetchedAtUnixMs = createMemo<number | null>(() => {
    const fromCheckNow = Number(checkNowAtUnixMs() ?? '')
    if (Number.isFinite(fromCheckNow) && fromCheckNow > 0) return fromCheckNow
    const fromQuery = Number(props.updateCheck.data?.fetched_at_unix_ms ?? '')
    if (Number.isFinite(fromQuery) && fromQuery > 0) return fromQuery
    return null
  })
  const freshness = createMemo<'unknown' | 'fresh' | 'stale'>(() => {
    const ts = effectiveFetchedAtUnixMs()
    if (!ts) return 'unknown'
    const ageMs = Date.now() - ts
    if (ageMs < 15 * 60_000) return 'fresh'
    return 'stale'
  })
  const freshnessLabel = createMemo(() => {
    if (freshness() === 'fresh') return props.t('header.catalogFresh')
    if (freshness() === 'stale') return props.t('header.catalogStale')
    return props.t('header.catalogUnknown')
  })

  const currentLocaleLabel = createMemo(
    () => props.localeOptions.find((item) => item.value === props.locale)?.label ?? props.localeOptions[0]?.label ?? props.locale,
  )

  createEffect(() => {
    if (!showLanguageMenu()) return

    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (languageMenuRoot && languageMenuRoot.contains(target)) return
      setShowLanguageMenu(false)
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowLanguageMenu(false)
    }

    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  })

  async function triggerControlUpdate() {
    setControlUpdateSubmitting(true)
    props.pushToast('info', props.t('header.checking'), props.t('header.triggerControlUpdate'), undefined, {
      context: { scope: 'system', label: props.t('header.updateCenterTitle') },
    })
    try {
      const out = await props.triggerUpdate.mutateAsync(null)
      props.pushToast('success', props.t('header.updateTriggered'), out.message || props.t('header.watchtowerUpdateRequested'), undefined, {
        context: { scope: 'system', label: props.t('header.updateCenterTitle') },
      })
      setTimeout(() => {
        try {
          window.location.reload()
        } catch {
          // ignore
        }
      }, 3000)
    } catch (error) {
      props.toastError(props.t('header.updateFailed'), error, {
        context: { scope: 'system', label: props.t('header.updateCenterTitle') },
        retry: { key: 'update.triggerControlUpdate' },
        onRetry: triggerControlUpdate,
      })
    } finally {
      setControlUpdateSubmitting(false)
    }
  }

  async function handleCheckNow() {
    if (checkNowSubmitting()) return
    setCheckNowSubmitting(true)
    props.pushToast('info', props.t('header.checking'), props.t('header.refreshingUpdateCatalog'), undefined, {
      context: { scope: 'system', label: props.t('header.updateCenterTitle') },
    })
    try {
      const csrf = await ensureCsrfCookie()
      const resp = await fetch('/rspc/update.checkNow', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrf,
        },
        body: 'null',
      })
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        throw new Error(text || `check now failed: ${resp.status}`)
      }
      const body = (await resp.json().catch(() => null)) as
        | { result?: { type?: string; data?: { fetched_at_unix_ms?: string } } }
        | null
      if (body?.result?.type === 'error') throw new Error('check now failed')
      const fetched = body?.result?.data?.fetched_at_unix_ms
      if (typeof fetched === 'string' && fetched.trim()) setCheckNowAtUnixMs(fetched)
      await props.updateCheck.refetch()
      props.pushToast('success', props.t('header.latest'), props.t('header.updateCatalogRefreshed'), undefined, {
        context: { scope: 'system', label: props.t('header.updateCenterTitle') },
      })
    } catch (error) {
      props.toastError(props.t('header.failedCheckUpdates'), error, {
        context: { scope: 'system', label: props.t('header.updateCenterTitle') },
        retry: { key: 'update.checkNow' },
        onRetry: handleCheckNow,
      })
    } finally {
      setCheckNowSubmitting(false)
    }
  }

  return (
    <header class="surface-glass relative z-50 mx-2 mt-2 flex h-14 flex-none items-center justify-between border-b px-3 sm:mx-3 sm:mt-3 sm:px-5">
      <div class="flex items-center gap-4">
        <IconButton label={props.t('header.openMenu')} class="sm:hidden" variant="secondary" onClick={() => props.setMobileNavOpen(true)}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
            <path
              fill-rule="evenodd"
              d="M3 5.75A.75.75 0 013.75 5h12.5a.75.75 0 010 1.5H3.75A.75.75 0 013 5.75zm0 4A.75.75 0 013.75 9h12.5a.75.75 0 010 1.5H3.75A.75.75 0 013 9.75zm0 4a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75a.75.75 0 01-.75-.75z"
              clip-rule="evenodd"
            />
          </svg>
        </IconButton>
        <div class="flex items-center gap-2">
          <img src="/logo.svg" class="h-7 w-7 rounded-lg" alt="Alloy" />
          <div class="leading-none">
            <div class="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">ALLOY</div>
            <div class="text-[10px] uppercase tracking-[0.2em] text-slate-500">{props.t('app.controlPlane')}</div>
          </div>
        </div>

        <div class="hidden sm:flex items-center gap-2 text-[11px] text-slate-500">
          <StatusPill
            label={props.t('status.backend')}
            state={{ loading: props.backendPending, error: props.backendError }}
            status={props.backendError ? props.t('status.offline') : props.backendPending ? props.t('status.loading') : props.t('status.ok')}
          />
        </div>
      </div>

      <div class="flex items-center gap-3">
        <Show when={import.meta.env.MODE !== 'production' || props.isReadOnly}>
          <div class="hidden items-center gap-1.5 sm:inline-flex">
            <Show when={import.meta.env.MODE !== 'production'}>
              <Badge variant="warning" title={props.t('header.environment')}>
                {import.meta.env.MODE.toUpperCase()}
              </Badge>
            </Show>
            <Show when={props.isReadOnly}>
              <Badge variant="danger" title={props.t('header.readOnlyMode')}>
                {props.t('header.readOnlyBadge')}
              </Badge>
            </Show>
          </div>
        </Show>

        <div class="relative" ref={(el) => (languageMenuRoot = el)}>
          <button
            type="button"
            class="ring-focus motion-surface motion-pop group inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-2xl border border-slate-200/90 bg-white/78 px-2.5 text-xs font-semibold text-slate-700 shadow-sm hover:-translate-y-0.5 hover:bg-white hover:shadow-md dark:border-slate-800 dark:bg-slate-950/62 dark:text-slate-200 dark:hover:bg-slate-900/90"
            title={`${props.t('header.language')}: ${currentLocaleLabel()}`}
            aria-label={`${props.t('header.language')}: ${currentLocaleLabel()}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              props.setShowAccountMenu(false)
              props.setShowUpdateCenter(false)
              setShowLanguageMenu((value) => !value)
            }}
            aria-expanded={showLanguageMenu()}
            aria-haspopup="menu"
          >
            <Languages class="h-3.5 w-3.5 text-slate-500 transition-colors group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-slate-200" strokeWidth={2} />
            <span class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 ring-1 ring-inset ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">
              {props.localeShort}
            </span>
            <ChevronDown class={`h-3.5 w-3.5 text-slate-500 transition-transform duration-150 dark:text-slate-400 ${showLanguageMenu() ? 'rotate-180' : ''}`} strokeWidth={2.25} />
          </button>

          <Show when={showLanguageMenu()}>
            <div
              class="surface-glass motion-enter-pop absolute right-0 top-10 z-[var(--z-popover)] mt-1 w-[min(92vw,14rem)] overflow-hidden p-1.5 shadow-2xl shadow-slate-900/12"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div class="text-kicker px-2 pb-1 pt-0.5">{props.t('header.language')}</div>
              <For each={props.localeOptions}>
                {(opt) => {
                  const active = () => opt.value === props.locale
                  return (
                    <button
                      type="button"
                      class={`ring-focus motion-surface group flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm font-medium ${
                        active()
                          ? 'bg-amber-500/12 text-slate-900 ring-1 ring-inset ring-amber-500/30 dark:bg-amber-500/18 dark:text-slate-100 dark:ring-amber-500/40'
                          : 'text-slate-700 hover:bg-slate-100/85 dark:text-slate-200 dark:hover:bg-slate-900/72'
                      }`}
                      onClick={() => {
                        props.setLocale(opt.value)
                        setShowLanguageMenu(false)
                      }}
                    >
                      <div class="flex min-w-0 items-center gap-2">
                        <span
                          class={`inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-[10px] font-bold ring-1 ring-inset ${
                            active()
                              ? 'bg-amber-500/24 text-amber-900 ring-amber-500/35 dark:bg-amber-500/28 dark:text-amber-100 dark:ring-amber-500/45'
                              : 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700'
                          }`}
                        >
                          {opt.shortLabel}
                        </span>
                        <span class="truncate">{opt.label}</span>
                      </div>

                      <div class="flex items-center gap-1.5">
                        <span class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                          {opt.value}
                        </span>
                        <Show when={active()}>
                          <Check class="h-4 w-4 text-amber-600 dark:text-amber-400" strokeWidth={2.5} />
                        </Show>
                      </div>
                    </button>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>

        <Show when={props.me?.is_admin}>
          <button
            type="button"
            class="ring-focus motion-surface motion-pop relative inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200/90 bg-white/78 text-slate-700 shadow-sm hover:-translate-y-0.5 hover:bg-white hover:shadow-md dark:border-slate-800 dark:bg-slate-950/62 dark:text-slate-200 dark:hover:bg-slate-900/90"
            title={hasAnyUpdate() ? props.t('header.updatesAvailable') : props.t('header.updateCenter')}
            aria-label={hasAnyUpdate() ? props.t('header.updatesAvailable') : props.t('header.updateCenter')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              setShowLanguageMenu(false)
              props.setShowAccountMenu(false)
              props.setShowUpdateCenter((value) => !value)
            }}
            aria-expanded={props.showUpdateCenter}
            aria-haspopup="menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
              <path d="M10 2.75a4.75 4.75 0 00-4.75 4.75v1.946l-.936 2.811A1.75 1.75 0 005.975 14.5h8.05a1.75 1.75 0 001.661-2.238l-.936-2.811V7.5A4.75 4.75 0 0010 2.75zM8.5 15.75a1.5 1.5 0 003 0h-3z" />
            </svg>
            <Show when={hasAnyUpdate()}>
              <span class="absolute -right-0.5 -top-0.5 inline-flex h-2.5 w-2.5">
                <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                <span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
              </span>
            </Show>
          </button>
        </Show>

        <button
          type="button"
          class={`ring-focus motion-surface motion-pop relative inline-flex h-8 min-w-8 items-center justify-center rounded-xl border border-slate-200/90 bg-white/78 text-slate-700 shadow-sm hover:-translate-y-0.5 hover:bg-white hover:shadow-md dark:border-slate-800 dark:bg-slate-950/62 dark:text-slate-200 dark:hover:bg-slate-900/90 ${props.eventUnreadCount > 0 ? 'ring-1 ring-amber-500/45 dark:ring-amber-400/45' : ''}`}
          title={props.t('eventCenter.title')}
          aria-label={props.t('eventCenter.title')}
          aria-haspopup="dialog"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            setShowLanguageMenu(false)
            props.setShowAccountMenu(false)
            props.setShowUpdateCenter(false)
            props.openEventCenter()
          }}
        >
          <Bell class="h-4 w-4" strokeWidth={2} />
          <Show when={props.eventUnreadCount > 0}>
            <span class="sr-only">{props.t('eventCenter.unreadCount', { count: props.eventUnreadCount })}</span>
          </Show>
          <Show when={props.eventUnreadCount > 0}>
            <span class="absolute -right-0.5 -top-0.5 inline-flex h-2.5 w-2.5">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            </span>
          </Show>
        </button>

        <button
          type="button"
          class="ring-focus motion-surface motion-pop sm:hidden rounded-xl border border-slate-200/90 bg-white/78 p-2 text-slate-700 shadow-sm hover:-translate-y-0.5 hover:bg-white hover:shadow-md dark:border-slate-800 dark:bg-slate-950/62 dark:text-slate-300 dark:hover:bg-slate-900/90"
          title={props.themeButtonTitle}
          onClick={() =>
            props.setThemePref((prev) => (prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system'))
          }
        >
          {props.themePref === 'dark' ? (
            <Moon class="h-4 w-4" strokeWidth={1.9} />
          ) : props.themePref === 'light' ? (
            <Sun class="h-4 w-4" strokeWidth={1.9} />
          ) : (
            <Monitor class="h-4 w-4" strokeWidth={1.9} />
          )}
        </button>

        <Show when={!props.authLoading} fallback={<div class="h-8 w-28 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />}>
          <Show
            when={props.me}
            fallback={
              <button
                type="button"
                class="ring-focus motion-surface motion-pop rounded-xl border border-amber-300/60 bg-gradient-to-b from-amber-200/85 via-amber-300/85 to-amber-400/90 px-3 py-2 text-xs font-semibold text-amber-950 shadow-sm hover:-translate-y-0.5 hover:shadow-md dark:border-amber-500/45 dark:from-amber-500/55 dark:via-amber-500/65 dark:to-amber-600/70 dark:text-amber-100"
                onClick={props.openLoginModal}
              >
                {props.t('header.initializeSession')}
              </button>
            }
          >
            <div class="relative">
              <button
                type="button"
                class="group inline-flex h-8 w-8 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/70 p-1 shadow-sm backdrop-blur-sm transition-all duration-150 hover:bg-white hover:shadow active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:bg-slate-950/80 dark:shadow-none dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950 sm:w-auto sm:justify-start sm:px-2 sm:py-1"
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={() => {
                  setShowLanguageMenu(false)
                  props.setShowUpdateCenter(false)
                  props.setShowAccountMenu((value) => !value)
                }}
                aria-expanded={props.showAccountMenu}
                aria-haspopup="menu"
              >
                <div class="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/10 text-[10px] font-semibold text-amber-900 ring-1 ring-inset ring-amber-500/20 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/25 sm:text-[11px]">
                  {props.me!.username.slice(0, 1).toUpperCase()}
                </div>
                <span class="hidden max-w-[11rem] truncate text-sm font-medium text-slate-900 dark:text-slate-100 sm:inline">
                  {props.me!.username}
                </span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  class="hidden h-4 w-4 text-slate-500 transition-transform group-hover:translate-y-0.5 sm:block"
                >
                  <path
                    fill-rule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                    clip-rule="evenodd"
                  />
                </svg>
              </button>

              <Show when={props.showUpdateCenter}>
                <Portal>
                  <div class="fixed inset-0 z-[var(--z-popover)]" onPointerDown={() => props.setShowUpdateCenter(false)}>
                    <div
                      class="surface-glass motion-enter-pop absolute right-3 top-13 mt-2 w-[min(94vw,32rem)] overflow-hidden shadow-2xl shadow-slate-900/12 sm:right-5 sm:top-14"
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <div class="border-b border-slate-200/90 px-3 py-2.5 dark:border-slate-800">
                        <div class="flex items-start justify-between gap-2">
                          <div>
                            <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">{props.t('header.updateCenterTitle')}</div>
                            <div class="mt-0.5 text-caption">{props.t('header.updateCenterDesc')}</div>
                          </div>
                          <div class="flex flex-wrap items-center justify-end gap-1.5">
                            <Show when={props.updateCheck.isPending || controlUpdateSubmitting() || checkNowSubmitting()}>
                              <Badge variant="neutral">{props.t('header.checking')}</Badge>
                            </Show>
                            <Show when={!props.updateCheck.isPending && !props.updateCheck.isError}>
                              <Badge variant={hasAnyUpdate() ? 'warning' : 'success'}>
                                {hasAnyUpdate() ? props.t('header.updateAvailable') : props.t('header.upToDate')}
                              </Badge>
                            </Show>
                            <Show when={props.updateCheck.data?.source?.kind}>
                              {(kind) => (
                                <Badge variant="neutral">
                                  {kind()}
                                  {props.updateCheck.data?.source?.channel ? `:${props.updateCheck.data?.source?.channel}` : ''}
                                </Badge>
                              )}
                            </Show>
                            <Badge variant={freshness() === 'fresh' ? 'success' : freshness() === 'stale' ? 'warning' : 'neutral'}>
                              {freshnessLabel()}
                            </Badge>
                          </div>
                        </div>
                      </div>

                      <div class="max-h-[70vh] overflow-auto p-3">
                        <div class="space-y-3">
                          <div class="surface-card motion-enter rounded-xl p-3">
                            <div class="flex items-center justify-between gap-2">
                              <div class="text-kicker">{props.t('header.control')}</div>
                              <Badge variant={hasControlUpdate() ? 'warning' : 'success'}>
                                {hasControlUpdate() ? props.t('header.updateAvailable') : props.t('header.upToDate')}
                              </Badge>
                            </div>
                            <div class="mt-1 text-xs text-slate-700 dark:text-slate-200">
                              {props.t('header.current')} <span class="font-mono">{props.controlVersion ?? '—'}</span>
                            </div>
                            <Show when={props.updateCheck.data?.latest}>
                              {(latest) => (
                                <div class="mt-1 text-xs text-slate-700 dark:text-slate-200">
                                  {props.t('header.latest')}{' '}
                                  <a
                                    href={latest().url}
                                    target="_blank"
                                    rel="noreferrer"
                                    class="font-mono text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500 dark:text-slate-100 dark:decoration-slate-700 dark:hover:decoration-slate-500"
                                  >
                                    {latest().tag}
                                  </a>
                                </div>
                              )}
                            </Show>
                            <Show when={props.updateCheck.data?.latest?.published_at}>
                              {(publishedAt) => (
                                <div class="mt-1 text-caption">
                                  {props.t('header.published')} <span class="font-mono">{publishedAt()}</span>
                                </div>
                              )}
                            </Show>
                          </div>

                          <div class="surface-card motion-enter rounded-xl p-3">
                            <div class="flex items-center justify-between gap-2">
                              <div class="text-kicker">{props.t('header.agent')}</div>
                              <Badge variant={hasAgentUpdate() ? 'warning' : 'success'}>
                                {hasAgentUpdate()
                                  ? props.t('header.nodesOutdated', { count: props.agentOutdatedCount })
                                  : props.t('header.nodesUpToDate')}
                              </Badge>
                            </div>
                            <Show when={props.updateCheck.data?.agent_latest}>
                              {(latest) => (
                                <div class="mt-1 text-xs text-slate-700 dark:text-slate-200">
                                  {props.t('header.latest')}{' '}
                                  <a
                                    href={latest().url}
                                    target="_blank"
                                    rel="noreferrer"
                                    class="font-mono text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500 dark:text-slate-100 dark:decoration-slate-700 dark:hover:decoration-slate-500"
                                  >
                                    {latest().tag}
                                  </a>
                                </div>
                              )}
                            </Show>
                            <div class="mt-1 text-caption">
                              {props.t('header.nodesManageUpdates', { count: props.agentNodeCount })}
                            </div>
                          </div>

                          <Show when={props.updateCheck.data?.source?.kind === 'manifest' ? props.updateCheck.data?.source?.manifest_url : null}>
                            {(manifestUrl) => (
                              <div class="text-caption">
                                {props.t('header.manifestSource')}{' '}
                                <a
                                  href={manifestUrl()}
                                  target="_blank"
                                  rel="noreferrer"
                                  class="font-mono text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500 dark:text-slate-100 dark:decoration-slate-700 dark:hover:decoration-slate-500"
                                >
                                  {manifestUrl()}
                                </a>
                              </div>
                            )}
                          </Show>

                          <Show when={effectiveFetchedAtUnixMs()}>
                            {(ts) => (
                              <div class="text-caption">
                                {props.t('header.lastCatalogSync')} <span class="font-mono">{formatDateTime(ts())}</span>
                              </div>
                            )}
                          </Show>

                          <Show when={props.updateCheck.data?.compatibility}>
                            {(compat) => (
                              <div class="rounded-xl border border-slate-200/95 bg-slate-50/92 p-3 text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-900/45 dark:text-slate-200">
                                {props.t('header.compatibility')}
                                <Show when={compat().control_min_agent}>
                                  {(min) => (
                                    <>
                                      {' '}· agent ≥ <span class="font-mono">{min()}</span>
                                    </>
                                  )}
                                </Show>
                                <Show when={compat().control_max_agent}>
                                  {(max) => (
                                    <>
                                      {' '}· agent ≤ <span class="font-mono">{max()}</span>
                                    </>
                                  )}
                                </Show>
                                <Show when={compat().note}>
                                  {(note) => <div class="mt-1">{note()}</div>}
                                </Show>
                              </div>
                            )}
                          </Show>

                          <Show when={props.updateCheck.data?.source?.warning}>
                            {(warning) => (
                              <div class="rounded-xl border border-amber-200/95 bg-amber-50/94 p-3 text-[11px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200">
                                {warning()}
                              </div>
                            )}
                          </Show>

                          <Show when={props.updateCheck.isError}>
                            <div class="rounded-xl border border-rose-200/95 bg-rose-50/94 p-3 text-[11px] text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/35 dark:text-rose-200">
                              {props.t('header.failedCheckUpdates')}
                            </div>
                          </Show>

                          <div class="flex flex-wrap items-center gap-2 pt-1">
                            <Button size="sm" variant="secondary" loading={checkNowSubmitting()} disabled={props.updateCheck.isPending || checkNowSubmitting()} onClick={() => void handleCheckNow()}>
                              {props.t('header.checkNow')}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                props.setShowUpdateCenter(false)
                                props.openNodesTab()
                              }}
                            >
                              {props.t('header.openNodes')}
                            </Button>
                            <Button
                              size="sm"
                              variant="primary"
                              loading={props.triggerUpdate.isPending}
                              disabled={
                                props.isReadOnly ||
                                props.triggerUpdate.isPending ||
                                props.updateCheck.isPending ||
                                !props.updateCheck.data?.can_trigger_update ||
                                !hasControlUpdate()
                              }
                              title={
                                props.isReadOnly
                                  ? props.t('header.readOnlyMode')
                                  : !props.updateCheck.data?.can_trigger_update
                                    ? props.t('header.updaterNotConfigured')
                                    : !hasControlUpdate()
                                      ? props.t('header.alreadyUpToDate')
                                      : props.t('header.triggerControlUpdate')
                              }
                              onClick={async () => {
                                await triggerControlUpdate()
                              }}
                            >
                              {props.t('header.updateControl')}
                            </Button>
                          </div>

                          <Show when={props.updateCheck.data && !props.updateCheck.data.can_trigger_update}>
                            <div class="text-caption">{props.t('header.oneClickWatchtowerHint')}</div>
                          </Show>

                          <Show when={props.updateCheck.data?.latest?.body}>
                            {(body) => (
                              <details class="rounded-xl border border-slate-200/95 bg-slate-50/92 p-3 text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-900/45 dark:text-slate-200">
                                <summary class="cursor-pointer select-none font-medium">{props.t('header.controlReleaseNotes')}</summary>
                                <pre class="mt-2 max-h-56 overflow-auto rounded-lg bg-slate-950 px-2.5 py-2 whitespace-pre-wrap text-slate-100">{body()}</pre>
                              </details>
                            )}
                          </Show>
                        </div>
                      </div>
                    </div>
                  </div>
                </Portal>
              </Show>

              <Show when={props.showAccountMenu}>
                <Portal>
                  <div class="fixed inset-0 z-[var(--z-popover)]" onPointerDown={() => props.setShowAccountMenu(false)}>
                    <div
                      class="surface-glass motion-enter-pop absolute right-3 top-13 mt-2 w-[min(92vw,14rem)] origin-top-right overflow-hidden shadow-2xl shadow-slate-900/12 sm:right-5 sm:top-14"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <div class="border-b border-slate-200/90 px-3 py-2.5 dark:border-slate-800">
                        <div class="flex items-center gap-3">
                          <div class="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/10 text-xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-500/20 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/25">
                            {props.me!.username.slice(0, 1).toUpperCase()}
                          </div>
                          <div class="min-w-0">
                            <div class="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{props.me!.username}</div>
                            <div class="mt-0.5 text-caption">
                              {props.me!.is_admin ? props.t('header.roleAdministrator') : props.t('header.roleUser')}
                            </div>
                            <Show when={props.controlVersion}>
                              {(version) => (
                                <div class="mt-0.5 text-caption">
                                  {props.t('header.control')} <span class="font-mono">v{version()}</span>
                                </div>
                              )}
                            </Show>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        class="ring-focus motion-surface flex w-full items-center px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900/50"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => {
                          props.setShowAccountMenu(false)
                          props.openDiagnostics()
                        }}
                      >
                        <span>{props.t('header.diagnostics')}</span>
                      </button>
                      <Show when={props.me?.is_admin}>
                        <button
                          type="button"
                          class="ring-focus motion-surface flex w-full items-center px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900/50"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => {
                            props.setShowAccountMenu(false)
                            props.openSettingsTab()
                          }}
                        >
                          <span>{props.t('tab.settings')}</span>
                        </button>
                      </Show>
                      <button
                        type="button"
                        class="ring-focus motion-surface flex w-full items-center px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900/50"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={async () => {
                          props.setShowAccountMenu(false)
                          await props.handleLogout()
                        }}
                      >
                        <span>{props.t('header.logout')}</span>
                      </button>
                    </div>
                  </div>
                </Portal>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </header>
  )
}
