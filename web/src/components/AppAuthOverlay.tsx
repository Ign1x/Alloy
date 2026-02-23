import { Show } from 'solid-js'

import type { I18nTranslate } from '../app/i18n'

interface AppAuthOverlayProps {
  authError: string | null
  t: I18nTranslate
  openLoginModal: () => void
}

export default function AppAuthOverlay(props: AppAuthOverlayProps) {
  return (
    <div class="absolute inset-0 z-40 flex items-center justify-center bg-white/72 px-4 backdrop-blur-md dark:bg-slate-950/75">
      <div class="surface-glass w-full max-w-md border p-6 shadow-[var(--app-shadow-xl)] dark:shadow-none">
        <div class="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-300">{props.t('auth.systemLockedBannerLocalized')}</div>
        <div class="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{props.t('auth.workspaceLocked')}</div>
        <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">{props.t('auth.signInPrompt')}</div>
        <Show when={props.authError}>
          <div class="mt-3 rounded-xl border border-rose-200/95 bg-rose-50/94 p-3 text-xs text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/35 dark:text-rose-200">
            {props.authError}
          </div>
        </Show>
        <div class="mt-5 flex gap-3">
          <button
            type="button"
            class="ring-focus motion-surface motion-pop flex-1 rounded-xl border border-amber-300/60 bg-gradient-to-b from-amber-200/85 via-amber-300/85 to-amber-400/90 px-3 py-2 text-xs font-semibold text-amber-950 shadow-sm hover:-translate-y-0.5 hover:shadow-md dark:border-amber-500/45 dark:from-amber-500/55 dark:via-amber-500/65 dark:to-amber-600/70 dark:text-amber-100"
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
