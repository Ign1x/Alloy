import { Show } from 'solid-js'
import { safeCopy } from '../../app/helpers/misc'
import { LabelTip } from '../../app/primitives/LabelTip'
import { VisibilityToggle } from '../../app/primitives/VisibilityToggle'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { IconButton } from '../../components/ui/IconButton'
import { Input } from '../../components/ui/Input'

export type DstCreateSectionProps = {
  [key: string]: unknown
}

export default function DstCreateSection(props: DstCreateSectionProps) {
  const {
    selectedTemplate,
    createAdvanced,
    setCreateAdvanced,
    createAdvancedDirty,
    createFieldErrors,
    setCreateDstClusterTokenEl,
    dstClusterToken,
    setDstClusterToken,
    dstClusterTokenVisible,
    setDstClusterTokenVisible,
    setCreateDstClusterNameEl,
    dstClusterName,
    setDstClusterName,
    setCreateDstMaxPlayersEl,
    dstMaxPlayers,
    setDstMaxPlayers,
    setCreateDstPasswordEl,
    dstPassword,
    setDstPassword,
    dstPasswordVisible,
    setDstPasswordVisible,
    setCreateDstPortEl,
    dstPort,
    setDstPort,
    setCreateDstMasterPortEl,
    dstMasterPort,
    setDstMasterPort,
    setCreateDstAuthPortEl,
    dstAuthPort,
    setDstAuthPort,
  } = props as any

  return (
                      <Show when={selectedTemplate() === 'dst:vanilla'}>
                        <div class="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                          <div class="flex items-center justify-between gap-3">
                            <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                              Don't Starve Together
                            </div>
                            <Button
                              size="xs"
                              variant={createAdvanced() ? 'secondary' : 'ghost'}
                              onClick={() => setCreateAdvanced((v: boolean) => !v)}
                              title="Show or hide advanced fields"
                            >
                              <span class="inline-flex items-center gap-2">
                                {createAdvanced() ? 'Hide advanced' : 'Advanced'}
                                <Show when={!createAdvanced() && createAdvancedDirty()}>
                                  <span class="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                                </Show>
                              </span>
                            </Button>
                          </div>

                          <Field
                            label={
                              <LabelTip
                                label="Cluster token"
                                content="Required. Paste your cluster_token.txt contents from Klei."
                              />
                            }
                            required
                            error={createFieldErrors().cluster_token}
                          >
                            <div class="flex flex-wrap items-center gap-2">
                              <Input
                                ref={(el) => {
                                  setCreateDstClusterTokenEl?.(el)
                                }}
                                type={dstClusterTokenVisible() ? 'text' : 'password'}
                                value={dstClusterToken()}
                                onInput={(e) => setDstClusterToken(e.currentTarget.value)}
                                placeholder="Paste token…"
                                spellcheck={false}
                                invalid={Boolean(createFieldErrors().cluster_token)}
                                class="w-full flex-1 font-mono text-[11px]"
                                rightIcon={
                                  <VisibilityToggle
                                    visible={dstClusterTokenVisible()}
                                    labelWhenHidden="Show token"
                                    labelWhenVisible="Hide token"
                                    onToggle={() => setDstClusterTokenVisible((v: boolean) => !v)}
                                  />
                                }
                              />
                              <IconButton
                                type="button"
                                size="sm"
                                variant="secondary"
                                label="Copy token"
                                disabled={!dstClusterToken().trim()}
                                onClick={() => void safeCopy(dstClusterToken().trim())}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                  <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                                  <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                                </svg>
                              </IconButton>
                            </div>
                          </Field>

                          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field label="Cluster name" error={createFieldErrors().cluster_name}>
                              <Input
                                ref={(el) => {
                                  setCreateDstClusterNameEl?.(el)
                                }}
                                value={dstClusterName()}
                                onInput={(e) => setDstClusterName(e.currentTarget.value)}
                                placeholder="Alloy DST server"
                                spellcheck={false}
                                invalid={Boolean(createFieldErrors().cluster_name)}
                              />
                            </Field>

                            <Field label={<LabelTip label="Max players" content="Maximum concurrent players allowed to join." />} error={createFieldErrors().max_players}>
                              <Input
                                ref={(el) => {
                                  setCreateDstMaxPlayersEl?.(el)
                                }}
                                type="number"
                                value={dstMaxPlayers()}
                                onInput={(e) => setDstMaxPlayers(e.currentTarget.value)}
                                placeholder="6"
                                invalid={Boolean(createFieldErrors().max_players)}
                              />
                            </Field>
                          </div>

                          <Field label={<LabelTip label="Password (optional)" content="Optional cluster password for joining players." />} error={createFieldErrors().password}>
                            <div class="flex flex-wrap items-center gap-2">
                              <Input
                                ref={(el) => {
                                  setCreateDstPasswordEl?.(el)
                                }}
                                type={dstPasswordVisible() ? 'text' : 'password'}
                                value={dstPassword()}
                                onInput={(e) => setDstPassword(e.currentTarget.value)}
                                placeholder="(none)"
                                invalid={Boolean(createFieldErrors().password)}
                                class="w-full flex-1"
                                rightIcon={
                                  <VisibilityToggle
                                    visible={dstPasswordVisible()}
                                    labelWhenHidden="Show password"
                                    labelWhenVisible="Hide password"
                                    onToggle={() => setDstPasswordVisible((v: boolean) => !v)}
                                  />
                                }
                              />
                              <IconButton
                                type="button"
                                size="sm"
                                variant="secondary"
                                label="Copy password"
                                disabled={!dstPassword().trim()}
                                onClick={() => void safeCopy(dstPassword().trim())}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                  <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                                  <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                                </svg>
                              </IconButton>
                            </div>
                          </Field>

                          <Show when={createAdvanced()}>
                            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                              <Field label={<LabelTip label="Port (UDP)" content="Client connection port. Use 0 to auto-assign." />} error={createFieldErrors().port}>
                                <Input
                                  ref={(el) => {
                                    setCreateDstPortEl?.(el)
                                  }}
                                  type="number"
                                  value={dstPort()}
                                  onInput={(e) => setDstPort(e.currentTarget.value)}
                                  placeholder="0"
                                  invalid={Boolean(createFieldErrors().port)}
                                />
                              </Field>

                              <Field
                                label={<LabelTip label="Master (UDP)" content="Steam master server port. Use 0 to auto-assign." />}
                                error={createFieldErrors().master_port}
                              >
                                <Input
                                  ref={(el) => {
                                    setCreateDstMasterPortEl?.(el)
                                  }}
                                  type="number"
                                  value={dstMasterPort()}
                                  onInput={(e) => setDstMasterPort(e.currentTarget.value)}
                                  placeholder="0"
                                  invalid={Boolean(createFieldErrors().master_port)}
                                />
                              </Field>

                              <Field
                                label={<LabelTip label="Auth (UDP)" content="Steam authentication port. Use 0 to auto-assign." />}
                                error={createFieldErrors().auth_port}
                              >
                                <Input
                                  ref={(el) => {
                                    setCreateDstAuthPortEl?.(el)
                                  }}
                                  type="number"
                                  value={dstAuthPort()}
                                  onInput={(e) => setDstAuthPort(e.currentTarget.value)}
                                  placeholder="0"
                                  invalid={Boolean(createFieldErrors().auth_port)}
                                />
                              </Field>
                            </div>
                          </Show>
                        </div>
                      </Show>
  )
}
