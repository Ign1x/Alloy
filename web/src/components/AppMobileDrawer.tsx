import { Show, type Setter } from 'solid-js'

import type { ThemePreference } from '../app/hooks/useThemePreference'
import type { UiTab } from '../app/types'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Drawer } from './ui/Drawer'

type AuthUser = { username: string; is_admin: boolean } | null

interface AppMobileDrawerProps {
  mobileNavOpen: boolean
  setMobileNavOpen: Setter<boolean>
  tab: UiTab
  setTab: Setter<UiTab>
  me: AuthUser
  themePref: ThemePreference
  setThemePref: Setter<ThemePreference>
  isReadOnly: boolean
  openLoginModal: () => void
  handleLogout: () => Promise<void>
}

export default function AppMobileDrawer(props: AppMobileDrawerProps) {
  return (
    <Drawer open={props.mobileNavOpen} onClose={() => props.setMobileNavOpen(false)} title="Menu">
      <div class="space-y-2">
        <button
          type="button"
          class={`w-full rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
            props.tab === 'instances'
              ? 'border-amber-500/20 bg-amber-500/10 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-100'
              : 'border-slate-200 bg-white/70 text-slate-800 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900'
          }`}
          onClick={() => {
            props.setTab('instances')
            props.setMobileNavOpen(false)
          }}
        >
          Instances
        </button>
        <button
          type="button"
          class={`w-full rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
            props.tab === 'downloads'
              ? 'border-amber-500/20 bg-amber-500/10 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-100'
              : 'border-slate-200 bg-white/70 text-slate-800 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900'
          }`}
          onClick={() => {
            props.setTab('downloads')
            props.setMobileNavOpen(false)
          }}
        >
          Downloads
        </button>
        <button
          type="button"
          class={`w-full rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
            props.tab === 'files'
              ? 'border-amber-500/20 bg-amber-500/10 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-100'
              : 'border-slate-200 bg-white/70 text-slate-800 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900'
          }`}
          onClick={() => {
            props.setTab('files')
            props.setMobileNavOpen(false)
          }}
        >
          Files
        </button>
        <button
          type="button"
          class={`w-full rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
            props.tab === 'nodes'
              ? 'border-amber-500/20 bg-amber-500/10 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-100'
              : 'border-slate-200 bg-white/70 text-slate-800 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900'
          }`}
          onClick={() => {
            props.setTab('nodes')
            props.setMobileNavOpen(false)
          }}
        >
          Nodes
        </button>
        <button
          type="button"
          class={`w-full rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
            props.tab === 'frp'
              ? 'border-amber-500/20 bg-amber-500/10 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-100'
              : 'border-slate-200 bg-white/70 text-slate-800 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900'
          }`}
          onClick={() => {
            props.setTab('frp')
            props.setMobileNavOpen(false)
          }}
        >
          FRP
        </button>
        <Show when={props.me?.is_admin}>
          <button
            type="button"
            class={`w-full rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
              props.tab === 'settings'
                ? 'border-amber-500/20 bg-amber-500/10 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-100'
                : 'border-slate-200 bg-white/70 text-slate-800 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900'
            }`}
            onClick={() => {
              props.setTab('settings')
              props.setMobileNavOpen(false)
            }}
          >
            Settings
          </button>
        </Show>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => props.setThemePref((prev) => (prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system'))}
        >
          Theme: {props.themePref}
        </Button>
        <Show when={import.meta.env.MODE !== 'production'}>
          <Badge variant="warning">{import.meta.env.MODE.toUpperCase()}</Badge>
        </Show>
        <Show when={props.isReadOnly}>
          <Badge variant="danger">READ-ONLY</Badge>
        </Show>
      </div>

      <div class="mt-4">
        <Show
          when={props.me}
          fallback={
            <Button
              variant="primary"
              size="md"
              class="w-full"
              onClick={() => {
                props.setMobileNavOpen(false)
                props.openLoginModal()
              }}
            >
              Sign in
            </Button>
          }
        >
          <Button
            variant="secondary"
            size="md"
            class="w-full"
            onClick={async () => {
              props.setMobileNavOpen(false)
              await props.handleLogout()
            }}
          >
            Logout
          </Button>
        </Show>
      </div>
    </Drawer>
  )
}
