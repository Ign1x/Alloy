import { Moon, Monitor, Sun } from 'lucide-solid'
import { Show, type Setter } from 'solid-js'

import type { ThemePreference } from '../app/hooks/useThemePreference'
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
}

export default function AppSidebarNav(props: AppSidebarNavProps) {
  return (
    <nav
      class={`hidden sm:flex ${props.sidebarExpanded ? 'w-56' : 'w-16'} flex-none flex-col gap-3 border-r border-slate-200 bg-white px-2 py-4 dark:border-slate-800 dark:bg-slate-950`}
      aria-label="Primary navigation"
    >
      <button
        type="button"
        class={`mt-1 flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-900/60 ${
          props.sidebarExpanded ? '' : 'justify-center'
        }`}
        onClick={() => props.setTab('instances')}
        aria-label="Go to Instances"
        title="Alloy"
      >
        <img src="/logo.svg" class="h-9 w-9 rounded-xl" alt="Alloy" />
        <Show when={props.sidebarExpanded}>
          <div class="min-w-0">
            <div class="truncate font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Alloy</div>
            <div class="text-[10px] uppercase tracking-[0.2em] text-slate-500">control plane</div>
          </div>
        </Show>
      </button>

      <div class="mt-2 flex w-full flex-col gap-1">
        <button
          type="button"
          class={`group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
            props.tab === 'instances'
              ? 'bg-amber-500/10 text-amber-800 ring-1 ring-inset ring-amber-500/20 dark:text-amber-200'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900/60 dark:hover:text-slate-100'
          } ${props.sidebarExpanded ? '' : 'justify-center'}`}
          onClick={() => props.setTab('instances')}
          aria-label="Instances"
          title="Instances"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
            <path d="M3 4.75A1.75 1.75 0 014.75 3h2.5A1.75 1.75 0 019 4.75v2.5A1.75 1.75 0 017.25 9h-2.5A1.75 1.75 0 013 7.25v-2.5zM11 4.75A1.75 1.75 0 0112.75 3h2.5A1.75 1.75 0 0117 4.75v2.5A1.75 1.75 0 0115.25 9h-2.5A1.75 1.75 0 0111 7.25v-2.5zM3 12.75A1.75 1.75 0 014.75 11h2.5A1.75 1.75 0 019 12.75v2.5A1.75 1.75 0 017.25 17h-2.5A1.75 1.75 0 013 15.25v-2.5zM11 12.75A1.75 1.75 0 0112.75 11h2.5A1.75 1.75 0 0117 12.75v2.5A1.75 1.75 0 0115.25 17h-2.5A1.75 1.75 0 0111 15.25v-2.5z" />
          </svg>
          <Show when={props.sidebarExpanded}>
            <span class="text-sm font-medium">Instances</span>
          </Show>
        </button>

        <button
          type="button"
          class={`group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
            props.tab === 'downloads'
              ? 'bg-amber-500/10 text-amber-800 ring-1 ring-inset ring-amber-500/20 dark:text-amber-200'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900/60 dark:hover:text-slate-100'
          } ${props.sidebarExpanded ? '' : 'justify-center'}`}
          onClick={() => props.setTab('downloads')}
          aria-label="Downloads"
          title="Downloads"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
            <path
              fill-rule="evenodd"
              d="M10 2.75a.75.75 0 01.75.75v8.19l2.22-2.22a.75.75 0 111.06 1.06l-3.5 3.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06l2.22 2.22V3.5a.75.75 0 01.75-.75zM3.5 14.25a.75.75 0 01.75.75v.75c0 .69.56 1.25 1.25 1.25h9c.69 0 1.25-.56 1.25-1.25V15a.75.75 0 011.5 0v.75A2.75 2.75 0 0114.5 18h-9a2.75 2.75 0 01-2.75-2.75V15a.75.75 0 01.75-.75z"
              clip-rule="evenodd"
            />
          </svg>
          <Show when={props.sidebarExpanded}>
            <span class="text-sm font-medium">Downloads</span>
          </Show>
        </button>

        <button
          type="button"
          class={`group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
            props.tab === 'files'
              ? 'bg-amber-500/10 text-amber-800 ring-1 ring-inset ring-amber-500/20 dark:text-amber-200'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900/60 dark:hover:text-slate-100'
          } ${props.sidebarExpanded ? '' : 'justify-center'}`}
          onClick={() => props.setTab('files')}
          aria-label="Files"
          title="Files"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
            <path d="M2 5.75A2.75 2.75 0 014.75 3h4.19a2.75 2.75 0 011.944.806l.56.56c.215.215.507.334.812.334h2.994A2.75 2.75 0 0118 7.45v6.8A2.75 2.75 0 0115.25 17H4.75A2.75 2.75 0 012 14.25v-8.5z" />
          </svg>
          <Show when={props.sidebarExpanded}>
            <span class="text-sm font-medium">Files</span>
          </Show>
        </button>

        <button
          type="button"
          class={`group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
            props.tab === 'nodes'
              ? 'bg-amber-500/10 text-amber-800 ring-1 ring-inset ring-amber-500/20 dark:text-amber-200'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900/60 dark:hover:text-slate-100'
          } ${props.sidebarExpanded ? '' : 'justify-center'}`}
          onClick={() => props.setTab('nodes')}
          aria-label="Nodes"
          title="Nodes"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
            <path d="M4.75 3A2.75 2.75 0 002 5.75v.5A2.75 2.75 0 004.75 9h10.5A2.75 2.75 0 0018 6.25v-.5A2.75 2.75 0 0015.25 3H4.75z" />
            <path d="M4.75 11A2.75 2.75 0 002 13.75v.5A2.75 2.75 0 004.75 17h10.5A2.75 2.75 0 0018 14.25v-.5A2.75 2.75 0 0015.25 11H4.75z" />
          </svg>
          <Show when={props.sidebarExpanded}>
            <span class="text-sm font-medium">Nodes</span>
          </Show>
        </button>

        <button
          type="button"
          class={`group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
            props.tab === 'frp'
              ? 'bg-amber-500/10 text-amber-800 ring-1 ring-inset ring-amber-500/20 dark:text-amber-200'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900/60 dark:hover:text-slate-100'
          } ${props.sidebarExpanded ? '' : 'justify-center'}`}
          onClick={() => props.setTab('frp')}
          aria-label="FRP"
          title="FRP"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
            <path d="M4.75 4A1.75 1.75 0 003 5.75v8.5C3 15.216 3.784 16 4.75 16h1.5C7.216 16 8 15.216 8 14.25V11h4v3.25c0 .966.784 1.75 1.75 1.75h1.5c.966 0 1.75-.784 1.75-1.75v-8.5A1.75 1.75 0 0015.25 4h-1.5A1.75 1.75 0 0012 5.75V9H8V5.75A1.75 1.75 0 006.25 4h-1.5z" />
          </svg>
          <Show when={props.sidebarExpanded}>
            <span class="text-sm font-medium">FRP</span>
          </Show>
        </button>

        <Show when={props.me?.is_admin}>
          <button
            type="button"
            class={`group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
              props.tab === 'settings'
                ? 'bg-amber-500/10 text-amber-800 ring-1 ring-inset ring-amber-500/20 dark:text-amber-200'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900/60 dark:hover:text-slate-100'
            } ${props.sidebarExpanded ? '' : 'justify-center'}`}
            onClick={() => props.setTab('settings')}
            aria-label="Settings"
            title="Settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5" aria-hidden="true">
              <path
                fill-rule="evenodd"
                clip-rule="evenodd"
                d="M7.83922 1.80388C7.93271 1.33646 8.34312 1 8.81981 1H11.1802C11.6569 1 12.0673 1.33646 12.1608 1.80388L12.4913 3.45629C13.1956 3.72458 13.8454 4.10332 14.4196 4.57133L16.0179 4.03065C16.4694 3.8779 16.966 4.06509 17.2043 4.47791L18.3845 6.52207C18.6229 6.93489 18.5367 7.45855 18.1786 7.77322L16.9119 8.88645C16.9699 9.24909 17 9.62103 17 10C17 10.379 16.9699 10.7509 16.9119 11.1135L18.1786 12.2268C18.5367 12.5414 18.6229 13.0651 18.3845 13.4779L17.2043 15.5221C16.966 15.9349 16.4694 16.1221 16.0179 15.9693L14.4196 15.4287C13.8454 15.8967 13.1956 16.2754 12.4913 16.5437L12.1608 18.1961C12.0673 18.6635 11.6569 19 11.1802 19H8.81981C8.34312 19 7.93271 18.6635 7.83922 18.1961L7.50874 16.5437C6.80443 16.2754 6.1546 15.8967 5.58043 15.4287L3.98214 15.9694C3.5306 16.1221 3.03401 15.9349 2.79567 15.5221L1.61547 13.4779C1.37713 13.0651 1.4633 12.5415 1.82136 12.2268L3.08808 11.1135C3.03012 10.7509 3 10.379 3 10C3 9.62103 3.03012 9.2491 3.08808 8.88647L1.82136 7.77324C1.46331 7.45857 1.37713 6.93491 1.61547 6.52209L2.79567 4.47793C3.03401 4.06511 3.5306 3.87791 3.98214 4.03066L5.58042 4.57134C6.15459 4.10332 6.80442 3.72459 7.50874 3.45629L7.83922 1.80388ZM10 13C11.6569 13 13 11.6569 13 10C13 8.34315 11.6569 7 10 7C8.34315 7 7 8.34315 7 10C7 11.6569 8.34315 13 10 13Z"
              />
            </svg>
            <Show when={props.sidebarExpanded}>
              <span class="text-sm font-medium">Settings</span>
            </Show>
          </button>
        </Show>
      </div>

      <div class={`mt-auto flex w-full flex-col items-center gap-2 pb-2 ${props.sidebarExpanded ? 'px-1' : ''}`}>
        <IconButton
          label={props.sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          variant="ghost"
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
