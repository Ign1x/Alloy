import { Show } from 'solid-js'
import { isAlloyApiError } from '../rspc'
import { LabelTip } from '../app/primitives/LabelTip'
import { VisibilityToggle } from '../app/primitives/VisibilityToggle'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
import { Input } from './ui/Input'
import { Modal } from './ui/Modal'
import { Textarea } from './ui/Textarea'

export type FrpNodeModalProps = {
  [key: string]: unknown
}

function focus(el: HTMLInputElement | HTMLTextAreaElement | undefined) {
  if (!el) return false
  el.focus()
  el.select?.()
  return true
}

export default function FrpNodeModal(props: FrpNodeModalProps) {
  const {
    showFrpNodeModal,
    closeFrpNodeModal,
    editingFrpNodeId,
    frpCreateNode,
    frpUpdateNode,
    isReadOnly,
    frpNodeCanSave,
    frpNodeFieldErrors,
    setFrpNodeFieldErrors,
    frpNodeFormError,
    setFrpNodeFormError,
    frpNodeName,
    setFrpNodeName,
    frpNodeServerAddr,
    setFrpNodeServerAddr,
    frpNodeServerPort,
    setFrpNodeServerPort,
    frpNodeAllocatablePorts,
    setFrpNodeAllocatablePorts,
    frpNodeToken,
    setFrpNodeToken,
    frpNodeTokenVisible,
    setFrpNodeTokenVisible,
    frpNodeConfig,
    setFrpNodeConfig,
    frpNodeDetectedFormat,
    invalidateFrpNodes,
    pushToast,
  } = props as any

  let nameEl: HTMLInputElement | undefined
  let serverAddrEl: HTMLInputElement | undefined
  let serverPortEl: HTMLInputElement | undefined
  let configEl: HTMLTextAreaElement | undefined

  return (
        <Modal
          open={showFrpNodeModal()}
          onClose={() => closeFrpNodeModal()}
          title={editingFrpNodeId() ? 'Edit FRP node' : 'Add FRP node'}
          description="Store FRP server info and optional config. Config format is auto-detected (INI/TOML/YAML/JSON)."
          size="lg"
          initialFocus={() => nameEl}
          footer={
            <div class="flex gap-3">
              <Button variant="secondary" class="flex-1" onClick={() => closeFrpNodeModal()}>
                Cancel
              </Button>
              <Button
                variant="primary"
                class="flex-1"
                type="submit"
                form="alloy-frp-node"
                loading={frpCreateNode.isPending || frpUpdateNode.isPending}
                disabled={isReadOnly() || !frpNodeCanSave()}
              >
                Save
              </Button>
            </div>
          }
        >
          <form
            id="alloy-frp-node"
            class="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault()
              setFrpNodeFieldErrors({})
              setFrpNodeFormError(null)
              try {
                const id = editingFrpNodeId()
                const parsedPort = Number.parseInt(frpNodeServerPort().trim(), 10)
                const input = {
                  name: frpNodeName().trim(),
                  server_addr: frpNodeServerAddr().trim() || null,
                  server_port: Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : null,
                  allocatable_ports: frpNodeAllocatablePorts().trim() || null,
                  token: frpNodeToken().trim() || null,
                  config: frpNodeConfig(),
                }
                if (!id) {
                  const out = await frpCreateNode.mutateAsync(input)
                  pushToast('success', 'Saved', out.name)
                } else {
                  const out = await frpUpdateNode.mutateAsync({ id, ...input })
                  pushToast('success', 'Saved', out.name)
                }
                closeFrpNodeModal()
                void invalidateFrpNodes()
              } catch (err) {
                if (isAlloyApiError(err)) {
                  setFrpNodeFieldErrors(err.data.field_errors ?? {})
                  setFrpNodeFormError(err.data.message)
                  queueMicrotask(() => {
                    if (err.data.field_errors?.name) focus(nameEl)
                    else if (err.data.field_errors?.server_addr) focus(serverAddrEl)
                    else if (err.data.field_errors?.server_port) focus(serverPortEl)
                    else if (err.data.field_errors?.config) focus(configEl)
                  })
                  return
                }
                setFrpNodeFormError(err instanceof Error ? err.message : 'save failed')
              }
            }}
          >
            <Field label="Name" required error={frpNodeFieldErrors().name}>
              <Input
                ref={(el) => {
                  nameEl = el
                }}
                value={frpNodeName()}
                onInput={(e) => setFrpNodeName(e.currentTarget.value)}
                placeholder="e.g. my-frp"
                spellcheck={false}
                invalid={Boolean(frpNodeFieldErrors().name)}
              />
            </Field>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="FRP Server" required error={frpNodeFieldErrors().server_addr}>
                <Input
                  ref={(el) => {
                    serverAddrEl = el
                  }}
                  value={frpNodeServerAddr()}
                  onInput={(e) => setFrpNodeServerAddr(e.currentTarget.value)}
                  placeholder="e.g. 1.2.3.4 or frp.example.com"
                  spellcheck={false}
                  invalid={Boolean(frpNodeFieldErrors().server_addr)}
                />
              </Field>

              <Field label="Server port" required error={frpNodeFieldErrors().server_port}>
                <Input
                  ref={(el) => {
                    serverPortEl = el
                  }}
                  type="number"
                  value={frpNodeServerPort()}
                  onInput={(e) => setFrpNodeServerPort(e.currentTarget.value)}
                  placeholder="7000"
                  invalid={Boolean(frpNodeFieldErrors().server_port)}
                />
              </Field>
            </div>

            <Field
              label={<LabelTip label="Allocatable ports" content="Optional. For example: 20000-20100,21000. Used when remote_port is auto." />}
              error={frpNodeFieldErrors().allocatable_ports}
            >
              <Input
                value={frpNodeAllocatablePorts()}
                onInput={(e) => setFrpNodeAllocatablePorts(e.currentTarget.value)}
                placeholder="20000-20100,21000"
                spellcheck={false}
                class="font-mono text-[11px]"
                invalid={Boolean(frpNodeFieldErrors().allocatable_ports)}
              />
            </Field>

            <Field label="Token (optional)" error={frpNodeFieldErrors().token}>
              <Input
                type={frpNodeTokenVisible() ? 'text' : 'password'}
                value={frpNodeToken()}
                onInput={(e) => setFrpNodeToken(e.currentTarget.value)}
                placeholder="FRP token"
                spellcheck={false}
                class="font-mono text-[11px]"
                invalid={Boolean(frpNodeFieldErrors().token)}
                rightIcon={
                  <VisibilityToggle
                    visible={frpNodeTokenVisible()}
                    labelWhenHidden="Show token"
                    labelWhenVisible="Hide token"
                    onToggle={() => setFrpNodeTokenVisible((v: boolean) => !v)}
                  />
                }
              />
            </Field>

            <Field
              label={<LabelTip label="Config (optional)" content="Auto-detected: INI/TOML/YAML/JSON. If empty, Alloy generates a config from server fields above." />}
              error={frpNodeFieldErrors().config}
            >
              <Textarea
                ref={(el) => {
                  configEl = el
                }}
                value={frpNodeConfig()}
                onInput={(e) => setFrpNodeConfig(e.currentTarget.value)}
                placeholder="Paste FRP config (INI/TOML/YAML/JSON)"
                spellcheck={false}
                class="font-mono text-[11px]"
                invalid={Boolean(frpNodeFieldErrors().config)}
              />
              <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Detected format: <span class="font-mono uppercase">{frpNodeDetectedFormat()}</span>
              </div>
            </Field>

            <Show when={frpNodeFormError()}>
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
