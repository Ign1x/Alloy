import { createEffect, createMemo, createSignal } from 'solid-js'
import type { I18nTranslate } from '../i18n'

import { ensureCsrfCookie, logout, whoami } from '../../auth'
import { onAuthEvent, queryClient } from '../../rspc'

type SessionUser = { username: string; is_admin: boolean } | null

type UseAuthDomainParams = {
  onClearSelections: () => void
  t: I18nTranslate
}

export function useAuthDomain(params: UseAuthDomainParams) {
  const [me, setMe] = createSignal<SessionUser>(null)
  const [authLoading, setAuthLoading] = createSignal(true)
  const [authError, setAuthError] = createSignal<string | null>(null)
  const [loginUser, setLoginUser] = createSignal('admin')
  const [loginPass, setLoginPass] = createSignal('admin')
  const [showLoginModal, setShowLoginModal] = createSignal(false)
  const [focusLoginUsername, setFocusLoginUsername] = createSignal(false)

  let loginUsernameEl: HTMLInputElement | undefined
  let sessionFetchToken = 0

  async function refreshSession() {
    const token = ++sessionFetchToken
    setAuthLoading(true)
    setAuthError(null)
    try {
      const res = await whoami()
      if (token !== sessionFetchToken) return
      setMe(res ? { username: res.username, is_admin: res.is_admin } : null)
    } catch (e) {
      if (token !== sessionFetchToken) return
      setAuthError(e instanceof Error ? e.message : params.t('auth.error'))
      setMe(null)
    } finally {
      if (token === sessionFetchToken) setAuthLoading(false)
    }
  }

  async function handleLogout() {
    try {
      setAuthError(null)
      await logout()
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : params.t('auth.logoutError'))
    } finally {
      setMe(null)
      params.onClearSelections()
      queryClient.clear()
    }
  }

  function openLoginModal() {
    setAuthError(null)
    setShowLoginModal(true)
    setFocusLoginUsername(true)
  }

  createEffect(() => {
    void ensureCsrfCookie()
  })

  createEffect(() => {
    const off = onAuthEvent((e) => {
      if (e.type !== 'auth-expired') return
      setMe(null)
      params.onClearSelections()
      queryClient.clear()
      setAuthError(params.t('auth.sessionExpired'))
      setShowLoginModal(true)
      setFocusLoginUsername(true)
    })
    return off
  })

  createEffect(() => {
    if (!showLoginModal()) return
    if (!focusLoginUsername()) return
    setFocusLoginUsername(false)
    queueMicrotask(() => loginUsernameEl?.focus())
  })

  createEffect(() => {
    if (!showLoginModal()) return
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      setShowLoginModal(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  createEffect(() => {
    void refreshSession()
    return () => {
      sessionFetchToken++
    }
  })

  const isAuthed = createMemo(() => Boolean(me()))

  return {
    me,
    setMe,
    authLoading,
    setAuthLoading,
    authError,
    setAuthError,
    loginUser,
    setLoginUser,
    loginPass,
    setLoginPass,
    showLoginModal,
    setShowLoginModal,
    refreshSession,
    handleLogout,
    isAuthed,
    openLoginModal,
    setLoginUsernameEl: (el: HTMLInputElement | undefined) => {
      loginUsernameEl = el
    },
  }
}
