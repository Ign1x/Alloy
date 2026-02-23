import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import { ArrowUpDown, Search } from 'lucide-solid'
import type { I18nTranslate } from '../../app/i18n'
import { formatRelativeTime } from '../../app/helpers/format'
import { useSearchFocusShortcut } from '../../app/helpers/searchFocusShortcut'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
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
    focusCreateEntry,
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
    instanceViewPresets,
    isReadOnly,
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

  const shownInstanceCount = createMemo(() => filteredInstances().length)
  const totalInstanceCount = createMemo(() => (instances.data ?? []).length)

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

  const jumpToCreateEntry = () => {
    if (typeof focusCreateEntry === 'function') {
      focusCreateEntry()
      return
    }
    try {
      getCreateInstanceNameRef?.()?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch {
      // ignore
    }
    queueMicrotask(() => getCreateInstanceNameRef?.()?.focus?.())
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
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-section-title">{translate('instances.filter.title')}</div>
          <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span class="inline-flex items-center rounded-full border border-slate-200/90 bg-white/74 px-2 py-0.5 text-slate-600 dark:border-slate-800 dark:bg-slate-950/52 dark:text-slate-300">
              {translate('instances.filter.updated', { value: formatRelativeTime(instancesLastUpdatedAtUnixMs()) })}
            </span>
            <span class="inline-flex items-center rounded-full border border-amber-200/80 bg-amber-50/85 px-2 py-0.5 font-semibold text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/25 dark:text-amber-200">
              <span class="mr-1.5 text-[10px] uppercase tracking-wide text-amber-700/90 dark:text-amber-300/90">
                {translate('instances.filter.statsLabel')}
              </span>
              {translate('instances.filter.showing', {
                shown: shownInstanceCount(),
                total: totalInstanceCount(),
              })}
            </span>
          </div>
          <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{translate('instances.filters.shortcutHint')}</div>
          <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{translate('instances.filters.shortcutVisibleHint')}</div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            class="min-w-[8.5rem] h-11 px-4 sm:h-9 sm:px-3"
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
            onClick={jumpToCreateEntry}
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
                  class="ring-focus -m-1 inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none sm:h-auto sm:w-auto sm:p-1.5 dark:text-slate-400 dark:hover:bg-slate-900/60 dark:hover:text-slate-100"
                  aria-label={translate('instances.filter.clearSearch')}
                  title={translate('instances.filter.clearSearch')}
                  onClick={clearSearch}
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
        <div class="w-full sm:w-40">
          <Dropdown
            label=""
            ariaLabel={translate('instances.filter.statusAria')}
            title={instanceStatusFilter() === 'all' ? translate('instances.filter.statusAll') : selectedStatusLabel()}
            leftIcon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" class="h-4 w-4" aria-hidden="true">
                <circle cx="5.5" cy="10" r="1.8" stroke="currentColor" stroke-width="1.5" />
                <path d="M9.5 8h5" stroke="currentColor" stroke-linecap="round" stroke-width="1.5" />
                <path d="M9.5 12h3.5" stroke="currentColor" stroke-linecap="round" stroke-width="1.5" />
              </svg>
            }
            value={instanceStatusFilter()}
            options={instanceStatusFilterOptions()}
            onChange={(v) => setInstanceStatusFilter(v as any)}
          />
        </div>
        <div class="w-full sm:w-40 lg:w-44">
          <Dropdown
            label=""
            ariaLabel={translate('instances.filter.templateAria')}
            title={instanceTemplateFilter() === 'all' ? translate('instances.filter.templateAll') : selectedTemplateLabel()}
            leftIcon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" class="h-4 w-4" aria-hidden="true">
                <rect x="2.75" y="4" width="14.5" height="12" rx="2" stroke="currentColor" stroke-width="1.5" />
                <path d="M8.5 4v12" stroke="currentColor" stroke-width="1.5" />
                <path d="M2.75 9.5h5.75" stroke="currentColor" stroke-width="1.5" />
              </svg>
            }
            value={instanceTemplateFilter()}
            options={instanceTemplateFilterOptions()}
            onChange={setInstanceTemplateFilter}
          />
        </div>
      </div>

      <div class="mt-2 rounded-xl border border-slate-200/85 bg-white/58 p-2.5 dark:border-slate-800 dark:bg-slate-950/38">
        <div class="flex flex-wrap items-end gap-2">
          <div class="w-full sm:w-36 lg:w-40">
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
          <div class="w-full sm:w-52 lg:w-60">
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
          <div class="w-full sm:w-44 lg:w-52">
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
          <div class="flex w-full items-center gap-2 sm:w-auto sm:self-end">
            <Button size="xs" variant="secondary" class="flex-1 sm:flex-none" disabled={!canSavePreset()} onClick={savePreset}>
              {translate('instances.filters.presets.save')}
            </Button>
            <Button size="xs" variant="ghost" class="flex-1 sm:flex-none" disabled={!activePresetName()} onClick={deleteActivePreset}>
              {translate('instances.filters.presets.delete')}
            </Button>
          </div>
        </div>
      </div>

      <Show when={activeFilterChips().length > 0 || Boolean(activePresetName())}>
        <div class="mt-3 rounded-xl border border-slate-200/85 bg-white/58 p-2 dark:border-slate-800 dark:bg-slate-950/38">
          <div class="flex flex-wrap items-center gap-2">
            <Show when={activeFilterChips().length > 0}>
              <Button size="xs" variant="secondary" onClick={clearAllFilters}>
                {translate('instances.filters.clearAllWithCount', { count: activeFilterChips().length })}
              </Button>
            </Show>
            <Show when={activePresetName()}>
              <Badge variant="neutral" class="max-w-full gap-2 px-2.5 py-1 pr-2.5">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {translate('instances.filters.presets.active')}
                </span>
                <span class="max-w-[12rem] truncate text-[11px] font-semibold text-slate-800 dark:text-slate-100">{activePresetName()}</span>
              </Badge>
            </Show>
            <For each={activeFilterChips()}>
              {(chip) => (
                <Badge variant="neutral" class="max-w-full gap-2 px-2.5 py-1 pr-1.5">
                  <span class="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{chip.label}</span>
                  <span class="max-w-[16rem] truncate text-[11px] font-semibold text-slate-800 dark:text-slate-100">{chip.value}</span>
                  <button
                    type="button"
                    class="ring-focus rounded-full p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
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
          </div>
        </div>
      </Show>

      <div class="sr-only" aria-live="polite">
        {translate('instances.filters.shortcutHint')}
      </div>
    </>
  )
}
