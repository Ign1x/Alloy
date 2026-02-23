import { For, Show, type Setter } from 'solid-js'

import type { I18nTranslate } from '../app/i18n'
import type { ThemePreference } from '../app/hooks/useThemePreference'
import { getVisibleUiTabs } from '../app/tabRegistry'
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
  themeApplied: 'light' | 'dark'
  t: I18nTranslate
  openLoginModal: () => void
  handleLogout: () => Promise<void>
}

export default function AppMobileDrawer(props: AppMobileDrawerProps) {
  const visibleTabs = () => getVisibleUiTabs(Boolean(props.me?.is_admin))

  const themeModeLabel = () => {
    const pref = props.themePref
    if (pref === 'system') return props.t('theme.system')
    return props.themeApplied === 'dark' ? props.t('theme.dark') : props.t('theme.light')
  }

  return (
    <Drawer
      open={props.mobileNavOpen}
      onClose={() => props.setMobileNavOpen(false)}
      title={props.t('mobile.menu')}
      closeLabel={props.t('common.close')}
      closeAriaLabel={props.t('common.close')}
    >
      <nav class="space-y-2" aria-label={props.t('nav.primary')}>
        <For each={visibleTabs()}>
          {(item) => (
            <button
              type="button"
              class={`ring-focus motion-surface w-full rounded-xl border px-3 py-2.5 text-left text-sm font-semibold ${
                props.tab === item.id
                  ? 'border-amber-500/25 bg-amber-500/12 text-amber-900 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/18 dark:text-amber-100'
                  : 'border-slate-200/90 bg-white/76 text-slate-800 hover:bg-white dark:border-slate-800 dark:bg-slate-950/58 dark:text-slate-200 dark:hover:bg-slate-900/90'
              }`}
              onClick={() => {
                props.setTab(item.id)
                props.setMobileNavOpen(false)
              }}
              aria-label={props.t(item.labelKey)}
              title={props.t(item.labelKey)}
              aria-current={props.tab === item.id ? 'page' : undefined}
            >
              {props.t(item.labelKey)}
            </button>
          )}
        </For>
      </nav>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => props.setThemePref((prev) => (prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system'))}
        >
          {props.t('mobile.theme', { mode: themeModeLabel() })}
        </Button>
        <Show when={import.meta.env.MODE !== 'production'}>
          <Badge variant="warning">{import.meta.env.MODE.toUpperCase()}</Badge>
        </Show>
        <Show when={props.isReadOnly}>
          <Badge variant="danger">{props.t('header.readOnlyBadge')}</Badge>
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
              {props.t('mobile.signIn')}
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
            {props.t('header.logout')}
          </Button>
        </Show>
      </div>
    </Drawer>
  )
}
