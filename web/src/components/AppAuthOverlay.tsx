import { Show } from 'solid-js'

import type { I18nTranslate } from '../app/i18n'

interface AppAuthOverlayProps {
  authError: string | null
  t: I18nTranslate
  openLoginModal: () => void
}

export default function AppAuthOverlay(props: AppAuthOverlayProps) {
  return (
    <div class="absolute inset-0 z-40 flex items-center justify-center bg-white/70 backdrop-blur-sm dark:bg-slate-950/70">
      <div class="w-full max-w-md rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950/80">
        <div class="font-mono text-[11px] uppercase tracking-wider text-amber-400">{props.t('auth.systemLockedBannerLocalized')}</div>
        <div class="mt-2 text-sm text-slate-900 dark:text-slate-200">{props.t('auth.workspaceLocked')}</div>
        <div class="mt-1 text-xs text-slate-600 dark:text-slate-500">{props.t('auth.signInPrompt')}</div>
        <Show when={props.authError}>
          <div class="mt-3 rounded-lg border border-rose-900/40 bg-rose-950/20 p-3 text-xs text-rose-200">
            {props.authError}
          </div>
        </Show>
        <div class="mt-5 flex gap-3">
          <button
            class="flex-1 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-500/20 hover:bg-amber-500/15 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/20"
            onClick={props.openLoginModal}
          >
            {props.t('auth.initializeSessionLocalized')}
          </button>
          {/* no manual refresh here; keep the locked state deterministic */}
        </div>
      </div>
    </div>
  )
}
