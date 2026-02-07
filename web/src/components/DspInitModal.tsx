import { Show } from 'solid-js'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
import { Input } from './ui/Input'
import { Modal } from './ui/Modal'

export type DspInitModalProps = {
  [key: string]: unknown
}

export default function DspInitModal(props: DspInitModalProps) {
  const {
    showDspInitModal,
    closeDspInitModal,
    warmCache,
    createInstance,
    pendingCreateAfterDspInit,
    runDspInitAndMaybeCreate,
    warmFieldErrors,
    dspSteamGuardCode,
    setDspSteamGuardCode,
    warmFormError,
  } = props as any

  let guardCodeEl: HTMLInputElement | undefined

  return (
        <Modal
          open={showDspInitModal()}
          onClose={() => closeDspInitModal()}
          title="Steam Guard required"
          description="SteamCMD credentials come from Settings. Enter the latest Steam Guard code and retry."
          size="md"
          initialFocus={() => guardCodeEl}
          footer={
            <div class="flex gap-3">
              <Button variant="secondary" class="flex-1" onClick={() => closeDspInitModal()}>
                Cancel
              </Button>
              <Button
                variant="primary"
                class="flex-1"
                type="submit"
                form="alloy-dsp-init"
                loading={warmCache.isPending || createInstance.isPending}
              >
                {pendingCreateAfterDspInit() ? 'Retry & Create' : 'Retry'}
              </Button>
            </div>
          }
        >
          <form
            id="alloy-dsp-init"
            class="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault()
              await runDspInitAndMaybeCreate()
            }}
          >
            <Field label="Steam Guard code" required error={warmFieldErrors().steam_guard_code}>
              <Input
                ref={(el) => {
                  guardCodeEl = el
                }}
                value={dspSteamGuardCode()}
                onInput={(e) => setDspSteamGuardCode(e.currentTarget.value)}
                placeholder="12345"
                invalid={Boolean(warmFieldErrors().steam_guard_code)}
              />
            </Field>

            <Show when={warmFormError()}>
              <div class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                <div class="font-semibold">Initialization failed</div>
                <div class="mt-1 whitespace-pre-wrap break-words text-xs text-rose-800/90 dark:text-rose-200/90">{warmFormError()!.message}</div>
                <Show when={warmFormError()!.requestId}>
                  <div class="mt-2 text-[11px] text-rose-700/80 dark:text-rose-200/70 font-mono">req {warmFormError()!.requestId}</div>
                </Show>
              </div>
            </Show>
          </form>
        </Modal>
  )
}
