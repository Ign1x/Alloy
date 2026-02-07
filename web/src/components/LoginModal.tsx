import { Show } from 'solid-js'
import { login } from '../auth'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
import { Input } from './ui/Input'
import { Modal } from './ui/Modal'

export type LoginModalProps = {
  [key: string]: unknown
}

export default function LoginModal(props: LoginModalProps) {
  const {
    showLoginModal,
    me,
    setShowLoginModal,
    authLoading,
    authError,
    setAuthError,
    setAuthLoading,
    loginUser,
    setLoginUser,
    loginPass,
    setLoginPass,
    refreshSession,
    setLoginUsernameEl,
  } = props as any

  let usernameEl: HTMLInputElement | undefined

  return (
        <Modal
          open={showLoginModal() && !me()}
          onClose={() => setShowLoginModal(false)}
          title="Sign in"
          description="Enter your credentials to access the control plane."
          size="sm"
          initialFocus={() => usernameEl}
          footer={
            <div class="flex gap-3">
              <Button variant="secondary" class="flex-1" onClick={() => setShowLoginModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" class="flex-1" type="submit" form="alloy-login" loading={authLoading()}>
                Sign in
              </Button>
            </div>
          }
        >
          <form
            id="alloy-login"
            class="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                setAuthError(null)
                setAuthLoading(true)
                await login({ username: loginUser(), password: loginPass() })
                await refreshSession()
                setShowLoginModal(false)
              } catch (err) {
                setAuthError(err instanceof Error ? err.message : 'login failed')
              } finally {
                setAuthLoading(false)
              }
            }}
          >
            <Field label="Username" required>
              <Input
                ref={(el) => {
                  usernameEl = el
                  setLoginUsernameEl?.(el)
                }}
                value={loginUser()}
                onInput={(ev) => setLoginUser(ev.currentTarget.value)}
                autocomplete="username"
              />
            </Field>
            <Field label="Password" required>
              <Input
                type="password"
                value={loginPass()}
                onInput={(ev) => setLoginPass(ev.currentTarget.value)}
                autocomplete="current-password"
              />
            </Field>

            <Show when={authError()}>
              {(msg) => (
                <div class="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[12px] text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                  {msg()}
                </div>
              )}
            </Show>
          </form>
        </Modal>
  )
}
