import { Show } from 'solid-js'
import { isAlloyApiError } from '../rspc'
import { defaultControlWsUrl } from '../app/helpers/network'
import { safeCopy } from '../app/helpers/misc'
import { LabelTip } from '../app/primitives/LabelTip'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
import { IconButton } from './ui/IconButton'
import { Input } from './ui/Input'
import { Modal } from './ui/Modal'
import { Textarea } from './ui/Textarea'

export type AddNodeModalProps = {
  [key: string]: unknown
}

export default function AddNodeModal(props: AddNodeModalProps) {
  const {
    showCreateNodeModal,
    closeCreateNode,
    createNodeResult,
    createNode,
    createNodeName,
    setCreateNodeName,
    createNodeFieldErrors,
    setCreateNodeFieldErrors,
    createNodeFormError,
    setCreateNodeFormError,
    createNodeControlWsUrl,
    setCreateNodeControlWsUrl,
    setCreateNodeResult,
    pushToast,
    invalidateNodes,
    setSelectedNodeId,
    createNodeComposeYaml,
  } = props as any

  return (
        <Modal
          open={showCreateNodeModal()}
          onClose={() => closeCreateNode()}
          title="Add node"
          description="Creates a one-time token and a docker-compose snippet for an agent to connect back."
          size="lg"
          footer={
            <Show
              when={createNodeResult()}
              fallback={
                <div class="flex gap-3">
                  <Button variant="secondary" class="flex-1" onClick={() => closeCreateNode()}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    class="flex-1"
                    type="submit"
                    form="alloy-create-node"
                    loading={createNode.isPending}
                    disabled={!createNodeName().trim()}
                  >
                    Create
                  </Button>
                </div>
              }
            >
              <div class="flex gap-3">
                <Button variant="secondary" class="flex-1" onClick={() => closeCreateNode()}>
                  Close
                </Button>
              </div>
            </Show>
          }
        >
          <Show
            when={createNodeResult()}
            fallback={
              <form
                id="alloy-create-node"
                class="grid gap-4"
                onSubmit={async (e) => {
                  e.preventDefault()
                  setCreateNodeFieldErrors({})
                  setCreateNodeFormError(null)
                  try {
                    const out = await createNode.mutateAsync({ name: createNodeName().trim() })
                    setCreateNodeResult(out as any)
                    pushToast('success', 'Node created', (out as any).node?.name ?? '')
                    await invalidateNodes()
                    if ((out as any).node?.id) setSelectedNodeId((out as any).node.id)
                  } catch (err) {
                    if (isAlloyApiError(err)) {
                      setCreateNodeFieldErrors(err.data.field_errors ?? {})
                      setCreateNodeFormError(err.data.message)
                      return
                    }
                    setCreateNodeFormError(err instanceof Error ? err.message : 'create failed')
                  }
                }}
              >
                <Field label="Name" required error={createNodeFieldErrors().name}>
                  <Input
                    value={createNodeName()}
                    onInput={(e) => setCreateNodeName(e.currentTarget.value)}
                    placeholder="e.g. node-1"
                    spellcheck={false}
                    invalid={Boolean(createNodeFieldErrors().name)}
                  />
                </Field>

                <Field label={<LabelTip label="Control WS URL" content="The agent connects to this websocket endpoint (usually your panel URL)." />}>
                  <Input
                    value={createNodeControlWsUrl()}
                    onInput={(e) => setCreateNodeControlWsUrl(e.currentTarget.value)}
                    placeholder={defaultControlWsUrl()}
                    spellcheck={false}
                  />
                </Field>

                <Show when={createNodeFormError()}>
                  {(msg) => (
                    <div class="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[12px] text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                      {msg()}
                    </div>
                  )}
                </Show>
              </form>
            }
          >
            {(r) => (
              <div class="space-y-4">
                <div class="rounded-2xl border border-slate-200 bg-white/60 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Token</div>
                    <IconButton
                      type="button"
                      label="Copy token"
                      variant="secondary"
                      onClick={() => {
                        void safeCopy(r().connect_token)
                        pushToast('success', 'Copied', 'Token copied.')
                      }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                        <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                        <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                      </svg>
                    </IconButton>
                  </div>
                  <Input value={r().connect_token} readOnly class="mt-2 font-mono text-[11px]" />
                  <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Save it now — it’s only shown once.</div>
                </div>

                <div class="rounded-2xl border border-slate-200 bg-white/60 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">docker-compose.yml</div>
                    <IconButton
                      type="button"
                      label="Copy compose"
                      variant="secondary"
                      onClick={() => {
                        void safeCopy(createNodeComposeYaml())
                        pushToast('success', 'Copied', 'Compose copied.')
                      }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                        <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                        <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                      </svg>
                    </IconButton>
                  </div>

                  <div class="mt-3">
                    <Field label={<LabelTip label="Control WS URL" content="If your agent can’t reach the panel, update this URL and copy again." />}>
                      <Input
                        value={createNodeControlWsUrl()}
                        onInput={(e) => setCreateNodeControlWsUrl(e.currentTarget.value)}
                        placeholder={defaultControlWsUrl()}
                        spellcheck={false}
                      />
                    </Field>
                  </div>

                  <Textarea value={createNodeComposeYaml()} readOnly class="mt-3 font-mono text-[11px]" />
                </div>
              </div>
            )}
          </Show>
        </Modal>
  )
}
