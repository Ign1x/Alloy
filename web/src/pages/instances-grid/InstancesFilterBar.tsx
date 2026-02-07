import { Show } from 'solid-js'
import { ArrowUpDown, Search } from 'lucide-solid'
import { formatRelativeTime } from '../../app/helpers/format'
import { Banner } from '../../components/ui/Banner'
import { Button } from '../../components/ui/Button'
import { Dropdown } from '../../components/Dropdown'
import { ErrorState } from '../../components/ui/ErrorState'
import { Input } from '../../components/ui/Input'

export type InstancesFilterBarProps = {
  [key: string]: unknown
}

export default function InstancesFilterBar(props: InstancesFilterBarProps) {
  const {
    filteredInstances,
    getCreateInstanceNameRef,
    instanceSearchInput,
    instanceSortKey,
    instanceSortOptions,
    instanceStatusFilter,
    instanceStatusFilterOptions,
    instanceTemplateFilter,
    instanceTemplateFilterOptions,
    instances,
    instancesLastUpdatedAtUnixMs,
    invalidateInstances,
    isReadOnly,
    setInstanceSearch,
    setInstanceSearchInput,
    setInstanceSortKey,
    setInstanceStatusFilter,
    setInstanceTemplateFilter,
  } = props as any

  return (
    <>
                      <div class="flex flex-wrap items-center justify-between gap-3">
                        <div class="min-w-0">
                          <div class="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Instances</div>
                          <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                            <span>Updated {formatRelativeTime(instancesLastUpdatedAtUnixMs())}</span>
                            <span class="text-slate-300 dark:text-slate-700">•</span>
                            <span>
                              Showing {filteredInstances().length}/{(instances.data ?? []).length}
                            </span>
                          </div>
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
	                            <Button
	                              size="xs"
	                              variant="primary"
	                              leftIcon={
	                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                                  <path
	                                    fill-rule="evenodd"
	                                    d="M10 4.25a.75.75 0 01.75.75v4.25H15a.75.75 0 010 1.5h-4.25V15a.75.75 0 01-1.5 0v-4.25H5a.75.75 0 010-1.5h4.25V5a.75.75 0 01.75-.75z"
	                                    clip-rule="evenodd"
	                                  />
	                                </svg>
	                              }
	                              disabled={isReadOnly()}
	                              title={isReadOnly() ? 'Read-only mode' : 'Create a new instance'}
	                              onClick={() => {
                                try {
                                  getCreateInstanceNameRef?.()?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                } catch {
                                  // ignore
                                }
                                queueMicrotask(() => getCreateInstanceNameRef?.()?.focus?.())
                              }}
                            >
                              Create
                            </Button>
                        </div>
                      </div>

                      <div class="mt-3 flex flex-wrap items-center gap-2">
                        <div class="w-full sm:w-40 lg:w-44">
                          <Input
                            value={instanceSearchInput()}
                            onInput={(e) => setInstanceSearchInput(e.currentTarget.value)}
                            placeholder="Search…"
                            aria-label="Search instances"
                            spellcheck={false}
                            leftIcon={<Search class="h-4 w-4" strokeWidth={1.9} />}
                            rightIcon={
                              instanceSearchInput().length > 0 ? (
                                <button
                                  type="button"
                                  class="rounded-md p-1 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 dark:hover:bg-slate-900/60"
                                  aria-label="Clear search"
                                  title="Clear search"
                                  onClick={() => {
                                    setInstanceSearchInput('')
                                    setInstanceSearch('')
                                  }}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                    <path
                                      fill-rule="evenodd"
                                      d="M4.47 4.47a.75.75 0 011.06 0L10 8.94l4.47-4.47a.75.75 0 111.06 1.06L11.06 10l4.47 4.47a.75.75 0 11-1.06 1.06L10 11.06l-4.47 4.47a.75.75 0 11-1.06-1.06L8.94 10 4.47 5.53a.75.75 0 010-1.06z"
                                      clip-rule="evenodd"
                                    />
                                  </svg>
                                </button>
                              ) : undefined
                            }
                          />
                        </div>
                        <div class="w-full sm:w-36">
                          <Dropdown
                            label=""
                            ariaLabel="Filter by status"
                            title={instanceStatusFilter() === 'all' ? 'All statuses' : instanceStatusFilter()}
                            leftIcon={
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                <path
                                  fill-rule="evenodd"
                                  d="M10 2.25a.75.75 0 01.75.75v6a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75z"
                                  clip-rule="evenodd"
                                />
                                <path
                                  fill-rule="evenodd"
                                  d="M6.22 4.97a.75.75 0 011.06.08.75.75 0 01-.08 1.06 4.75 4.75 0 105.6 0 .75.75 0 01-.08-1.06.75.75 0 011.06-.08 6.25 6.25 0 11-7.48 0z"
                                  clip-rule="evenodd"
                                />
                              </svg>
                            }
                            value={instanceStatusFilter()}
                            options={instanceStatusFilterOptions()}
                            onChange={(v) => setInstanceStatusFilter(v as any)}
                          />
                        </div>
                        <div class="w-full sm:w-36 lg:w-40">
                          <Dropdown
                            label=""
                            ariaLabel="Filter by template"
                            title={instanceTemplateFilter() === 'all' ? 'All templates' : instanceTemplateFilter()}
                            leftIcon={
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                <path d="M10 2.25l6.5 3.75v7.5L10 17.25 3.5 13.5V6L10 2.25z" />
                                <path d="M10 9.75L3.5 6 10 2.25 16.5 6 10 9.75z" opacity="0.35" />
                                <path d="M10 9.75v7.5l6.5-3.75V6L10 9.75z" opacity="0.35" />
                              </svg>
                            }
                            value={instanceTemplateFilter()}
                            options={instanceTemplateFilterOptions()}
                            onChange={setInstanceTemplateFilter}
                          />
                        </div>
                      </div>

                      <div class="mt-2 flex flex-wrap items-center gap-2">
                        <div class="w-full sm:w-32">
                          <Dropdown
                            label=""
                            ariaLabel="Sort instances"
                            title="Sort"
                            leftIcon={<ArrowUpDown class="h-4 w-4" strokeWidth={1.9} />}
                            value={instanceSortKey()}
                            options={instanceSortOptions()}
                            onChange={(v) => setInstanceSortKey(v as any)}
                          />
                        </div>
                      </div>

                      <Show when={instances.isError && instances.data == null && (instances.error as unknown)}>
                        <ErrorState
                          class="mt-4"
                          title="Failed to load instances"
                          error={instances.error}
                          onRetry={() => void invalidateInstances()}
                        />
                      </Show>

                      <Show when={instances.isError && instances.data != null}>
                        <Banner
                          class="mt-4"
                          variant="warning"
                          title="Refresh failed"
                          message="Showing last known instance list."
                          actions={
                            <Button size="xs" variant="secondary" onClick={() => void invalidateInstances()}>
                              Retry
                            </Button>
                          }
                        />
                      </Show>
    </>
  )
}
