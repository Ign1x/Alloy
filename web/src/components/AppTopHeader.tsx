import { Moon, Monitor, Sun } from 'lucide-solid'
import { Show, type Setter } from 'solid-js'
import { Portal } from 'solid-js/web'

import type { ThemePreference } from '../app/hooks/useThemePreference'
import { Badge } from './ui/Badge'
import { IconButton } from './ui/IconButton'
import { StatusPill } from '../app/primitives/StatusPill'

type AuthUser = { username: string; is_admin: boolean } | null

interface AppTopHeaderProps {
  setMobileNavOpen: Setter<boolean>
  backendPending: boolean
  backendError: boolean
  agentPending: boolean
  agentError: boolean
  isReadOnly: boolean
  themeButtonTitle: string
  themePref: ThemePreference
  setThemePref: Setter<ThemePreference>
  authLoading: boolean
  me: AuthUser
  openLoginModal: () => void
  showAccountMenu: boolean
  setShowAccountMenu: Setter<boolean>
  openDiagnostics: () => void
  handleLogout: () => Promise<void>
}

export default function AppTopHeader(props: AppTopHeaderProps) {
  return (
    <header class="relative z-50 flex h-14 flex-none items-center justify-between border-b border-slate-200 bg-white/70 px-5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/70">
      <div class="flex items-center gap-4">
        <IconButton label="Open menu" class="sm:hidden" variant="secondary" onClick={() => props.setMobileNavOpen(true)}>
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
            <div class="text-[10px] uppercase tracking-[0.2em] text-slate-500">control plane</div>
          </div>
        </div>

        <div class="hidden md:flex items-center gap-2 text-[11px] text-slate-500">
          <StatusPill
            label="Backend"
            state={{ loading: props.backendPending, error: props.backendError }}
            status={props.backendError ? 'offline' : props.backendPending ? '...' : 'ok'}
          />
          <StatusPill
            label="Agent"
            state={{ loading: props.agentPending, error: props.agentError }}
            status={props.agentError ? 'offline' : props.agentPending ? '...' : 'ok'}
          />
        </div>
      </div>

      <div class="flex items-center gap-3">
        <Show when={import.meta.env.MODE !== 'production'}>
          <Badge variant="warning" title="Environment">
            {import.meta.env.MODE.toUpperCase()}
          </Badge>
        </Show>
        <Show when={props.isReadOnly}>
          <Badge variant="danger" title="Read-only mode">
            READ-ONLY
          </Badge>
        </Show>
        <button
          class="sm:hidden rounded-xl border border-slate-200 bg-white/70 p-2 text-slate-700 shadow-sm transition-colors hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:bg-slate-900"
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
                class="rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-500/20 hover:bg-amber-500/15 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/20"
                onClick={props.openLoginModal}
              >
                INITIALIZE_SESSION
              </button>
            }
          >
            <div class="relative">
              <button
                type="button"
                class="group inline-flex h-8 w-8 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/70 p-1 shadow-sm backdrop-blur-sm transition-all duration-150 hover:bg-white hover:shadow active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:bg-slate-950/80 dark:shadow-none dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950 sm:w-auto sm:justify-start sm:px-2 sm:py-1"
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={() => props.setShowAccountMenu((value) => !value)}
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

              <Show when={props.showAccountMenu}>
                <Portal>
                  <div class="fixed inset-0 z-[9999]" onPointerDown={() => props.setShowAccountMenu(false)}>
                    <div
                      class="absolute right-5 top-14 mt-2 w-56 origin-top-right overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 backdrop-blur transition-all duration-150 animate-in fade-in zoom-in-95 dark:border-slate-800 dark:bg-slate-950"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <div class="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
                        <div class="flex items-center gap-3">
                          <div class="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/10 text-xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-500/20 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/25">
                            {props.me!.username.slice(0, 1).toUpperCase()}
                          </div>
                          <div class="min-w-0">
                            <div class="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{props.me!.username}</div>
                            <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                              {props.me!.is_admin ? 'Administrator' : 'User'}
                            </div>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        class="flex w-full items-center px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900/50 dark:active:bg-slate-900"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => {
                          props.setShowAccountMenu(false)
                          props.openDiagnostics()
                        }}
                      >
                        <span>Diagnostics</span>
                      </button>
                      <button
                        type="button"
                        class="flex w-full items-center px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900/50 dark:active:bg-slate-900"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={async () => {
                          props.setShowAccountMenu(false)
                          await props.handleLogout()
                        }}
                      >
                        <span>Logout</span>
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
