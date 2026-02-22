import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import { ArrowUpDown, Search } from 'lucide-solid'
import type { I18nTranslate } from '../../app/i18n'
import { formatRelativeTime } from '../../app/helpers/format'
import { useSearchFocusShortcut } from '../../app/helpers/searchFocusShortcut'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { DataBoundary } from '../../components/ui/DataBoundary'
import { Dropdown } from '../../components/Dropdown'
import { Input } from '../../components/ui/Input'

export type InstancesFilterBarProps = {
  [key: string]: unknown
}

export default function InstancesFilterBar(props: InstancesFilterBarProps) {
  const DEFAULT_INSTANCE_SORT_KEY = 'updated'

  const {
    activeInstanceViewPresetId,
    applyInstanceViewPreset,
    deleteInstanceViewPreset,
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
    instanceViewPresets,
    isReadOnly,
    openSettingsTab,
    saveInstanceViewPreset,
    setInstanceSearch,
    setInstanceSearchInput,
    setInstanceSortKey,
    setInstanceStatusFilter,
    setInstanceTemplateFilter,
    t,
  } = props as any

  type PresetLike = { id: string; name: string }

  const translate = t as I18nTranslate
  let searchInputEl: HTMLInputElement | undefined
  const [presetNameInput, setPresetNameInput] = createSignal('')

  const clearSearch = () => {
    setInstanceSearchInput('')
    setInstanceSearch('')
  }

  const clearStatus = () => setInstanceStatusFilter('all')
  const clearTemplate = () => setInstanceTemplateFilter('all')
  const clearSort = () => setInstanceSortKey(DEFAULT_INSTANCE_SORT_KEY)

  const clearAllFilters = () => {
    clearSearch()
    clearStatus()
    clearTemplate()
    clearSort()
  }

  const selectedStatusLabel = createMemo(() => {
    const current = instanceStatusFilter()
    const option = instanceStatusFilterOptions().find((item: { value: string; label: string }) => item.value === current)
    return option?.label ?? current
  })

  const selectedTemplateLabel = createMemo(() => {
    const current = instanceTemplateFilter()
    const option = instanceTemplateFilterOptions().find((item: { value: string; label: string }) => item.value === current)
    return option?.label ?? current
  })

  const selectedSortLabel = createMemo(() => {
    const current = instanceSortKey()
    const option = instanceSortOptions().find((item: { value: string; label: string }) => item.value === current)
    return option?.label ?? current
  })

  const activeFilterChips = createMemo(() => {
    const chips: Array<{ id: string; label: string; value: string; onRemove: () => void }> = []
    const search = String(instanceSearchInput()).trim()
    if (search.length > 0) {
      chips.push({ id: 'search', label: translate('instances.filters.search'), value: search, onRemove: clearSearch })
    }
    if (instanceStatusFilter() !== 'all') {
      chips.push({ id: 'status', label: translate('instances.filters.status'), value: selectedStatusLabel(), onRemove: clearStatus })
    }
    if (instanceTemplateFilter() !== 'all') {
      chips.push({ id: 'template', label: translate('instances.filters.template'), value: selectedTemplateLabel(), onRemove: clearTemplate })
    }
    if (instanceSortKey() !== DEFAULT_INSTANCE_SORT_KEY) {
      chips.push({ id: 'sort', label: translate('instances.filters.sort'), value: selectedSortLabel(), onRemove: clearSort })
    }
    return chips
  })

  const presetOptions = createMemo(() => [
    { value: '', label: translate('instances.filters.presets.none') },
    ...instanceViewPresets().map((item: PresetLike) => ({ value: item.id, label: item.name })),
  ])

  const activePresetName = createMemo(() => {
    const id = String(activeInstanceViewPresetId())
    if (!id) return ''
    const matched = instanceViewPresets().find((item: PresetLike) => item.id === id)
    return matched?.name ?? ''
  })

  const canSavePreset = createMemo(() => presetNameInput().trim().length > 0)

  const savePreset = () => {
    if (!canSavePreset()) return
    const id = saveInstanceViewPreset(presetNameInput().trim())
    if (id) setPresetNameInput('')
  }

  const deleteActivePreset = () => {
    const id = String(activeInstanceViewPresetId())
    if (!id) return
    deleteInstanceViewPreset(id)
  }

  createEffect(() => {
    useSearchFocusShortcut({
      input: () => searchInputEl,
      queryValue: () => String(instanceSearchInput()),
      clearQuery: clearSearch,
    })
  })

  return (
    <>
                      <div class="flex flex-wrap items-center justify-between gap-3">
                        <div class="min-w-0">
                          <div class="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                            {translate('instances.filter.title')}
                          </div>
                      <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span>{translate('instances.filter.updated', { value: formatRelativeTime(instancesLastUpdatedAtUnixMs()) })}</span>
                        <span class="text-slate-300 dark:text-slate-700">•</span>
                            <span>
                              {translate('instances.filter.showing', {
                                shown: filteredInstances().length,
                                total: (instances.data ?? []).length,
                              })}
                            </span>
                            <span class="text-slate-300 dark:text-slate-700">•</span>
                            <span>{translate('instances.filters.shortcutVisibleHint')}</span>
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
	                              title={isReadOnly() ? translate('common.readOnlyMode') : translate('instances.filter.createTitle')}
	                              onClick={() => {
                                try {
                                  getCreateInstanceNameRef?.()?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                } catch {
                                  // ignore
                                }
                                queueMicrotask(() => getCreateInstanceNameRef?.()?.focus?.())
                              }}
                            >
                              {translate('instances.filter.create')}
                            </Button>
                        </div>
                      </div>

                      <div class="mt-3 flex flex-wrap items-center gap-2">
                        <div class="w-full sm:w-40 lg:w-44">
                          <Input
                            ref={(el) => {
                              searchInputEl = el
                            }}
                            value={instanceSearchInput()}
                            onInput={(e) => setInstanceSearchInput(e.currentTarget.value)}
                            placeholder={translate('instances.filter.searchPlaceholder')}
                            aria-label={translate('instances.filter.searchAria')}
                            spellcheck={false}
                            leftIcon={<Search class="h-4 w-4" strokeWidth={1.9} />}
                            rightIcon={
                              instanceSearchInput().length > 0 ? (
                                <button
                                  type="button"
                                  class="rounded-md p-1 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 dark:hover:bg-slate-900/60"
                                  aria-label={translate('instances.filter.clearSearch')}
                                  title={translate('instances.filter.clearSearch')}
                                  onClick={() => {
                                    clearSearch()
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
                            ariaLabel={translate('instances.filter.statusAria')}
                            title={instanceStatusFilter() === 'all' ? translate('instances.filter.statusAll') : instanceStatusFilter()}
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
                            ariaLabel={translate('instances.filter.templateAria')}
                            title={instanceTemplateFilter() === 'all' ? translate('instances.filter.templateAll') : instanceTemplateFilter()}
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
                            ariaLabel={translate('instances.filters.sort')}
                            title={translate('instances.filter.sortTitle')}
                            leftIcon={<ArrowUpDown class="h-4 w-4" strokeWidth={1.9} />}
                            value={instanceSortKey()}
                            options={instanceSortOptions()}
                            onChange={(v) => setInstanceSortKey(v as any)}
                          />
                        </div>
                      </div>

                      <div class="mt-2 flex flex-wrap items-center gap-2">
                        <div class="w-full sm:w-48 lg:w-56">
                          <Dropdown
                            label=""
                            ariaLabel={translate('instances.filters.presets.label')}
                            title={translate('instances.filters.presets.label')}
                            value={String(activeInstanceViewPresetId())}
                            options={presetOptions()}
                            onChange={(value) => {
                              if (!value) {
                                applyInstanceViewPreset('')
                                return
                              }
                              applyInstanceViewPreset(value)
                            }}
                          />
                        </div>
                        <div class="w-full sm:w-44 lg:w-48">
                          <Input
                            value={presetNameInput()}
                            onInput={(e) => setPresetNameInput(e.currentTarget.value)}
                            placeholder={translate('instances.filters.presets.namePlaceholder')}
                            aria-label={translate('instances.filters.presets.nameAria')}
                            spellcheck={false}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter') return
                              e.preventDefault()
                              savePreset()
                            }}
                          />
                        </div>
                        <Button size="xs" variant="secondary" disabled={!canSavePreset()} onClick={savePreset}>
                          {translate('instances.filters.presets.save')}
                        </Button>
                        <Button size="xs" variant="ghost" disabled={!activePresetName()} onClick={deleteActivePreset}>
                          {translate('instances.filters.presets.delete')}
                        </Button>
                      </div>

                      <Show when={activeFilterChips().length > 0}>
                        <div class="mt-3 flex flex-wrap items-center gap-2">
                          <Show when={activePresetName()}>
                            <Badge variant="neutral" class="max-w-full gap-1.5 pr-2">
                              <span class="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                {translate('instances.filters.presets.active')}
                              </span>
                              <span class="max-w-[12rem] truncate">{activePresetName()}</span>
                            </Badge>
                          </Show>
                          <For each={activeFilterChips()}>
                            {(chip) => (
                              <Badge variant="neutral" class="max-w-full gap-1.5 pr-1">
                                <span class="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{chip.label}</span>
                                <span class="max-w-[16rem] truncate">{chip.value}</span>
                                <button
                                  type="button"
                                  class="rounded-full p-0.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                                  aria-label={`${translate('instances.filters.remove')} ${chip.label}`}
                                  title={`${translate('instances.filters.remove')} ${chip.label}`}
                                  onClick={() => chip.onRemove()}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5">
                                    <path
                                      fill-rule="evenodd"
                                      d="M4.47 4.47a.75.75 0 011.06 0L10 8.94l4.47-4.47a.75.75 0 111.06 1.06L11.06 10l4.47 4.47a.75.75 0 11-1.06 1.06L10 11.06l-4.47 4.47a.75.75 0 11-1.06-1.06L8.94 10 4.47 5.53a.75.75 0 010-1.06z"
                                      clip-rule="evenodd"
                                    />
                                  </svg>
                                </button>
                              </Badge>
                            )}
                          </For>
                          <Button size="xs" variant="ghost" onClick={clearAllFilters}>
                            {translate('instances.filters.clearAll')}
                          </Button>
                        </div>
                      </Show>

                      <div class="sr-only" aria-live="polite">
                        {translate('instances.filters.shortcutHint')}
                      </div>

                      <DataBoundary
                        t={translate}
                        class="mt-4"
                        loading={false}
                        error={instances.error}
                        errorTitle={translate('instances.filter.loadFailed')}
                        hasData={(instances.data ?? []).length > 0}
                        empty={false}
                        onRetry={() => void invalidateInstances()}
                        onOpenSettings={openSettingsTab}
                        settingsCtaLabel={translate('tab.settings')}
                        stale={{
                          show: instances.isError && instances.data != null,
                          title: translate('instances.filter.refreshFailed'),
                          message: translate('instances.filter.snapshotInfo'),
                          onRetry: () => void invalidateInstances(),
                        }}
                      >
                        <></>
                      </DataBoundary>

    </>
  )
}
