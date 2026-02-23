import { Moon, Monitor, Sun } from 'lucide-solid'
import { For, Show, type Setter } from 'solid-js'

import type { I18nTranslate } from '../app/i18n'
import type { ThemePreference } from '../app/hooks/useThemePreference'
import { getVisibleUiTabs } from '../app/tabRegistry'
import type { UiTab } from '../app/types'
import { IconButton } from './ui/IconButton'

type AuthUser = { username: string; is_admin: boolean } | null

interface AppSidebarNavProps {
  sidebarExpanded: boolean
  setSidebarExpanded: Setter<boolean>
  tab: UiTab
  setTab: Setter<UiTab>
  me: AuthUser
  themePref: ThemePreference
  setThemePref: Setter<ThemePreference>
  themeButtonTitle: string
  t: I18nTranslate
}

export default function AppSidebarNav(props: AppSidebarNavProps) {
  const visibleTabs = () => getVisibleUiTabs(Boolean(props.me?.is_admin))

  return (
    <nav
      class={`motion-surface hidden sm:flex ${props.sidebarExpanded ? 'w-56' : 'w-[4.5rem]'} flex-none flex-col gap-3 border-r border-slate-200/95 bg-white/76 px-2 py-4 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/58 dark:shadow-none`}
      aria-label={props.t('nav.primary')}
    >
      <button
        type="button"
        class={`ring-focus motion-surface mt-1 flex items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-100/90 dark:hover:bg-slate-900/70 ${
          props.sidebarExpanded ? '' : 'justify-center'
        }`}
        onClick={() => props.setTab('instances')}
        aria-label={props.t('nav.goToInstances')}
        title={props.t('app.controlPlane')}
      >
        <img src="/logo.svg" class="h-9 w-9 rounded-xl" alt={props.t('app.controlPlane')} />
        <Show when={props.sidebarExpanded}>
          <div class="min-w-0">
            <div class="truncate font-display text-sm font-semibold text-slate-900 dark:text-slate-100">{props.t('app.controlPlane')}</div>
            <div class="text-[10px] uppercase tracking-[0.2em] text-slate-500">{props.t('app.controlPlane')}</div>
          </div>
        </Show>
      </button>

      <div class="mt-2 flex w-full flex-col gap-1">
        <For each={visibleTabs()}>
          {(item) => {
            const Icon = item.icon

            return (
              <button
                type="button"
                class={`ring-focus motion-surface group flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                  props.tab === item.id
                    ? 'bg-amber-500/12 text-amber-800 ring-1 ring-inset ring-amber-500/25 shadow-sm dark:text-amber-200'
                    : 'text-slate-600 hover:bg-slate-100/90 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900/70 dark:hover:text-slate-100'
                } ${props.sidebarExpanded ? '' : 'justify-center'}`}
                onClick={() => props.setTab(item.id)}
                aria-label={props.t(item.labelKey)}
                title={props.t(item.labelKey)}
                aria-current={props.tab === item.id ? 'page' : undefined}
              >
                <Icon class="h-5 w-5" />
                <Show when={props.sidebarExpanded}>
                  <span class="text-sm font-medium">{props.t(item.labelKey)}</span>
                </Show>
              </button>
            )
          }}
        </For>
      </div>

      <div class={`mt-auto flex w-full flex-col gap-2.5 pb-3 ${props.sidebarExpanded ? 'px-1' : 'items-center'}`}>
        <IconButton
          label={props.sidebarExpanded ? props.t('sidebar.collapse') : props.t('sidebar.expand')}
          variant="secondary"
          size="md"
          class={props.sidebarExpanded ? 'w-full' : ''}
          onClick={() => props.setSidebarExpanded((value) => !value)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
            <Show
              when={props.sidebarExpanded}
              fallback={
                <path
                  fill-rule="evenodd"
                  d="M8.22 4.47a.75.75 0 011.06 0l5 5a.75.75 0 010 1.06l-5 5a.75.75 0 11-1.06-1.06L12.69 10 8.22 5.53a.75.75 0 010-1.06z"
                  clip-rule="evenodd"
                />
              }
            >
              <path
                fill-rule="evenodd"
                d="M11.78 15.53a.75.75 0 01-1.06 0l-5-5a.75.75 0 010-1.06l5-5a.75.75 0 111.06 1.06L7.31 10l4.47 4.47a.75.75 0 010 1.06z"
                clip-rule="evenodd"
              />
            </Show>
          </svg>
        </IconButton>
        <IconButton
          label={props.themeButtonTitle}
          variant="secondary"
          size="md"
          class={props.sidebarExpanded ? 'w-full' : ''}
          onClick={() => props.setThemePref((prev) => (prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system'))}
        >
          <Show
            when={props.themePref === 'dark'}
            fallback={
              <Show when={props.themePref === 'light'} fallback={<Monitor class="h-4 w-4" strokeWidth={1.9} />}>
                <Sun class="h-4 w-4" strokeWidth={1.9} />
              </Show>
            }
          >
            <Moon class="h-4 w-4" strokeWidth={1.9} />
          </Show>
        </IconButton>
      </div>
    </nav>
  )
}
