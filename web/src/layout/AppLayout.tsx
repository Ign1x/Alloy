import type { JSX } from 'solid-js'
import { Show } from 'solid-js'

export type NavTab = 'instances' | 'files' | 'nodes'

export type AppLayoutProps = {
  tab: NavTab
  onTab: (t: NavTab) => void
  title: string
  status?: JSX.Element
  account?: JSX.Element
  children: JSX.Element
}

export default function AppLayout(props: AppLayoutProps) {
  return (
    <div class="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <nav class="hidden sm:flex w-16 flex-none flex-col items-center gap-3 border-r border-slate-200 bg-white px-2 py-4 dark:border-slate-800 dark:bg-slate-950">
        <img src="/logo.svg" class="mt-1 h-9 w-9 rounded-xl" alt="Alloy" />

        <div class="mt-2 flex w-full flex-col items-center gap-2">
          <NavButton active={props.tab === 'instances'} onClick={() => props.onTab('instances')} label="Instances">
            <IconServer />
          </NavButton>
          <NavButton active={props.tab === 'files'} onClick={() => props.onTab('files')} label="Files">
            <IconFolder />
          </NavButton>
          <NavButton active={props.tab === 'nodes'} onClick={() => props.onTab('nodes')} label="Nodes">
            <IconNodes />
          </NavButton>
        </div>

        <div class="mt-auto flex w-full flex-col items-center gap-2 pb-2">{props.account}</div>
      </nav>

      <div class="flex min-w-0 flex-1 flex-col">
        <header class="flex h-14 flex-none items-center justify-between border-b border-slate-200 bg-white/70 px-5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/70">
          <div class="flex min-w-0 items-center gap-4">
            <div class="flex items-center gap-2">
              <img src="/logo.svg" class="h-7 w-7 rounded-lg" alt="Alloy" />
              <div class="min-w-0">
                <div class="text-base font-semibold tracking-tight font-display">{props.title}</div>
              </div>
            </div>
            <Show when={props.status}>
              <div class="hidden md:flex items-center gap-2 font-mono text-[11px] text-slate-400">{props.status}</div>
            </Show>
          </div>
          <div class="flex items-center gap-3">{props.account}</div>
        </header>

        <main class="min-h-0 flex-1 overflow-hidden">{props.children}</main>

        <nav class="sm:hidden flex h-12 flex-none items-center justify-around border-t border-slate-200 bg-white/70 px-2 dark:border-slate-800 dark:bg-slate-950/80">
          <BottomTab active={props.tab === 'instances'} onClick={() => props.onTab('instances')}>
            Instances
          </BottomTab>
          <BottomTab active={props.tab === 'files'} onClick={() => props.onTab('files')}>
            Files
          </BottomTab>
          <BottomTab active={props.tab === 'nodes'} onClick={() => props.onTab('nodes')}>
            Nodes
          </BottomTab>
        </nav>
      </div>
    </div>
  )
}

function NavButton(props: { active: boolean; onClick: () => void; label: string; children: JSX.Element }) {
  return (
    <button
      class={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
        props.active
          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900/60 dark:hover:text-slate-100'
      }`}
      onClick={props.onClick}
      title={props.label}
    >
      {props.children}
    </button>
  )
}

function BottomTab(props: { active: boolean; onClick: () => void; children: JSX.Element }) {
  return (
    <button
      class={`flex flex-1 items-center justify-center rounded-xl py-2 text-xs ${
        props.active
          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900/60'
      }`}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

function IconServer() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
      <path d="M4.5 4A2.5 2.5 0 002 6.5v1A2.5 2.5 0 004.5 10h11A2.5 2.5 0 0018 7.5v-1A2.5 2.5 0 0015.5 4h-11z" />
      <path
        fill-rule="evenodd"
        d="M2 12.5A2.5 2.5 0 014.5 10h11a2.5 2.5 0 012.5 2.5v1A2.5 2.5 0 0115.5 16h-11A2.5 2.5 0 012 13.5v-1zm3.75.25a.75.75 0 000 1.5h.5a.75.75 0 000-1.5h-.5z"
        clip-rule="evenodd"
      />
    </svg>
  )
}

function IconFolder() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
      <path d="M4.75 3A2.75 2.75 0 002 5.75v8.5A2.75 2.75 0 004.75 17h10.5A2.75 2.75 0 0018 14.25V7.45A2.75 2.75 0 0015.25 4.7h-2.994a1.25 1.25 0 01-.884-.366l-.56-.56A2.75 2.75 0 009.69 3H4.75z" />
    </svg>
  )
}

function IconNodes() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
      <path
        fill-rule="evenodd"
        d="M6.5 3a3.5 3.5 0 103.3 4.65 5.5 5.5 0 017.58 5.02V14a3 3 0 01-3 3H13a3 3 0 01-3-3v-1.33a3.5 3.5 0 10-3.5 3.33h.5a.75.75 0 000-1.5h-.5a2 2 0 112 2v-.5a.75.75 0 011.5 0V14a4.5 4.5 0 004.5 4.5h1.08A4.5 4.5 0 0020 14v-1.33a7 7 0 00-9.68-6.43A3.5 3.5 0 006.5 3z"
        clip-rule="evenodd"
      />
    </svg>
  )
}
