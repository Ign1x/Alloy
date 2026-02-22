import { createEffect, createMemo, createSignal } from 'solid-js'

import type { ProcessStatusDto } from '../../bindings'
import type { I18nTranslate } from '../i18n'
import { queryClient, rspc } from '../../rspc'
import { instancePort } from '../helpers/network'

type InstanceStatusFilter = 'all' | 'running' | 'stopped' | 'starting' | 'stopping' | 'failed'
type InstanceSortKey = 'name' | 'updated' | 'status' | 'port'

type InstanceViewPreset = {
  id: string
  name: string
  q: string
  status: InstanceStatusFilter
  template: string
  sort_key: InstanceSortKey
}

type InstanceListItem = {
  config: {
    instance_id: string
    template_id: string
    params: unknown
    display_name: string | null
    node_id?: string | null
    node_name?: string | null
  }
  status: ProcessStatusDto | null
}

type UseInstancesDomainParams = {
  isAuthed: () => boolean
  t: I18nTranslate
}

function isInstanceStatusFilter(value: unknown): value is InstanceStatusFilter {
  return value === 'all' || value === 'running' || value === 'stopped' || value === 'starting' || value === 'stopping' || value === 'failed'
}

function isInstanceSortKey(value: unknown): value is InstanceSortKey {
  return value === 'name' || value === 'updated' || value === 'status' || value === 'port'
}

export function useInstancesDomain(params: UseInstancesDomainParams) {
  const [instancesPollMs, setInstancesPollMs] = createSignal<number | false>(false)
  const [instancesPollErrorStreak, setInstancesPollErrorStreak] = createSignal(0)

  const instances = rspc.createQuery(
    () => ['instance.list', null],
    () => ({
      enabled: params.isAuthed(),
      refetchInterval: instancesPollMs(),
      refetchOnWindowFocus: false,
      retry: 3,
      retryDelay: (attempt) => Math.min(400 * Math.pow(2, attempt), 4000),
    }),
  )

  const [instancesLastUpdatedAtUnixMs, setInstancesLastUpdatedAtUnixMs] = createSignal<number | null>(null)

  createEffect(() => {
    if (!instances.data) return
    setInstancesLastUpdatedAtUnixMs(Date.now())
  })

  const INSTANCE_VIEW_STORAGE_KEY = 'alloy.instances.view'
  const INSTANCE_VIEW_PRESETS_STORAGE_KEY = 'alloy.instances.view.presets.v1'
  const [instanceSearchInput, setInstanceSearchInput] = createSignal('')
  const [instanceSearch, setInstanceSearch] = createSignal('')
  const [instanceStatusFilter, setInstanceStatusFilter] = createSignal<InstanceStatusFilter>('all')
  const [instanceTemplateFilter, setInstanceTemplateFilter] = createSignal<string>('all')
  const [instanceSortKey, setInstanceSortKey] = createSignal<InstanceSortKey>('updated')
  const instanceCompact = () => true
  const [pinnedInstanceIds, setPinnedInstanceIds] = createSignal<Record<string, boolean>>({})
  const [instanceViewPresets, setInstanceViewPresets] = createSignal<InstanceViewPreset[]>([])
  const [activeInstanceViewPresetId, setActiveInstanceViewPresetId] = createSignal('')

  function makePresetId() {
    return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  function currentViewSnapshot() {
    return {
      q: instanceSearchInput().trim(),
      status: instanceStatusFilter(),
      template: instanceTemplateFilter(),
      sort_key: instanceSortKey(),
    }
  }

  function applyInstanceViewPreset(id: string) {
    const preset = instanceViewPresets().find((item) => item.id === id)
    if (!preset) {
      setActiveInstanceViewPresetId('')
      return
    }
    setInstanceSearchInput(preset.q)
    setInstanceSearch(preset.q.trim().toLowerCase())
    setInstanceStatusFilter(preset.status)
    setInstanceTemplateFilter(preset.template)
    setInstanceSortKey(preset.sort_key)
    setActiveInstanceViewPresetId(preset.id)
  }

  function saveInstanceViewPreset(name: string): string | null {
    const normalizedName = name.trim()
    if (!normalizedName) return null

    const snapshot = currentViewSnapshot()
    let savedId = ''

    setInstanceViewPresets((prev) => {
      const next = [...prev]
      const existingIndex = next.findIndex((item) => item.name.trim().toLowerCase() === normalizedName.toLowerCase())

      if (existingIndex >= 0) {
        const existing = next[existingIndex]!
        savedId = existing.id
        next[existingIndex] = {
          ...existing,
          name: normalizedName,
          ...snapshot,
        }
        return next
      }

      savedId = makePresetId()
      next.push({
        id: savedId,
        name: normalizedName,
        ...snapshot,
      })
      return next
    })

    setActiveInstanceViewPresetId(savedId)
    return savedId
  }

  function deleteInstanceViewPreset(id: string) {
    if (!id) return
    setInstanceViewPresets((prev) => prev.filter((item) => item.id !== id))
    if (activeInstanceViewPresetId() === id) setActiveInstanceViewPresetId('')
  }

  createEffect(() => {
    const v = instanceSearchInput()
    const handle = window.setTimeout(() => setInstanceSearch(v.trim().toLowerCase()), 180)
    return () => window.clearTimeout(handle)
  })

  createEffect(() => {
    try {
      const raw = localStorage.getItem(INSTANCE_VIEW_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as any
      if (typeof parsed?.q === 'string') setInstanceSearchInput(parsed.q)
      if (isInstanceStatusFilter(parsed?.status)) {
        setInstanceStatusFilter(parsed.status)
      }
      if (typeof parsed?.template === 'string') setInstanceTemplateFilter(parsed.template)
      if (isInstanceSortKey(parsed?.sort_key)) {
        setInstanceSortKey(parsed.sort_key)
      }
      if (parsed?.pinned && typeof parsed.pinned === 'object') {
        const next: Record<string, boolean> = {}
        for (const [k, v] of Object.entries(parsed.pinned as Record<string, unknown>)) {
          if (typeof v === 'boolean') next[k] = v
        }
        setPinnedInstanceIds(next)
      }
    } catch {}
  })

  createEffect(() => {
    try {
      localStorage.setItem(
        INSTANCE_VIEW_STORAGE_KEY,
        JSON.stringify({
          q: instanceSearchInput(),
          status: instanceStatusFilter(),
          template: instanceTemplateFilter(),
          sort_key: instanceSortKey(),
          pinned: pinnedInstanceIds(),
        }),
      )
    } catch {}
  })

  createEffect(() => {
    try {
      const raw = localStorage.getItem(INSTANCE_VIEW_PRESETS_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as any
      const rawPresets = Array.isArray(parsed?.presets) ? parsed.presets : []
      const seen = new Set<string>()
      const nextPresets: InstanceViewPreset[] = []

      for (const row of rawPresets) {
        if (!row || typeof row !== 'object') continue
        const id = typeof row.id === 'string' ? row.id.trim() : ''
        const name = typeof row.name === 'string' ? row.name.trim() : ''
        const q = typeof row.q === 'string' ? row.q : ''
        const status = row.status
        const template = typeof row.template === 'string' ? row.template : 'all'
        const sortKey = row.sort_key
        if (!id || !name || seen.has(id)) continue
        if (!isInstanceStatusFilter(status)) continue
        if (!isInstanceSortKey(sortKey)) continue
        seen.add(id)
        nextPresets.push({
          id,
          name,
          q,
          status,
          template,
          sort_key: sortKey,
        })
      }

      setInstanceViewPresets(nextPresets)

      const activeId = typeof parsed?.active_id === 'string' ? parsed.active_id.trim() : ''
      if (activeId && nextPresets.some((item) => item.id === activeId)) setActiveInstanceViewPresetId(activeId)
      else setActiveInstanceViewPresetId('')
    } catch {}
  })

  createEffect(() => {
    try {
      const activeId = activeInstanceViewPresetId()
      const presets = instanceViewPresets()
      const normalizedActiveId = presets.some((item) => item.id === activeId) ? activeId : ''
      localStorage.setItem(
        INSTANCE_VIEW_PRESETS_STORAGE_KEY,
        JSON.stringify({
          active_id: normalizedActiveId,
          presets,
        }),
      )
    } catch {}
  })

  createEffect(() => {
    const activeId = activeInstanceViewPresetId()
    if (!activeId) return
    const preset = instanceViewPresets().find((item) => item.id === activeId)
    if (!preset) {
      setActiveInstanceViewPresetId('')
      return
    }

    const snapshot = currentViewSnapshot()
    if (
      snapshot.q !== preset.q ||
      snapshot.status !== preset.status ||
      snapshot.template !== preset.template ||
      snapshot.sort_key !== preset.sort_key
    ) {
      setActiveInstanceViewPresetId('')
    }
  })

  createEffect(() => {
    if (!params.isAuthed()) {
      setInstancesPollMs(false)
      setInstancesPollErrorStreak(0)
      return
    }

    const list = instances.data ?? []
    const count = list.length
    const anyStartingOrStopping = list.some((i: { status?: { state?: string } | null }) => {
      const s = i.status?.state
      return s === 'PROCESS_STATE_STARTING' || s === 'PROCESS_STATE_STOPPING'
    })
    const anyRunning = list.some((i: { status?: { state?: string } | null }) => i.status?.state === 'PROCESS_STATE_RUNNING')

    let base = anyStartingOrStopping ? 800 : anyRunning ? 2000 : 5000
    if (count >= 20) base = Math.min(base * 2, 15_000)
    if (count >= 60) base = Math.min(base * 2, 30_000)

    if (instances.isError && instances.data == null) {
      base = 800
    }

    const nextStreak = instances.isError ? Math.min(instancesPollErrorStreak() + 1, 6) : 0
    setInstancesPollErrorStreak(nextStreak)
    const backoff = Math.min(base * Math.pow(2, nextStreak), 30_000)

    const jitter = Math.floor(Math.random() * 200)
    setInstancesPollMs(backoff + jitter)
  })

  const [instanceStatusKeys, setInstanceStatusKeys] = createSignal<Record<string, { key: string; updated_at_unix_ms: number }>>({})

  createEffect(() => {
    const list = (instances.data ?? []) as InstanceListItem[]
    setInstanceStatusKeys((prev) => {
      const next: Record<string, { key: string; updated_at_unix_ms: number }> = { ...prev }
      const seen = new Set<string>()
      const now = Date.now()

      for (const inst of list) {
        const id = inst.config.instance_id
        seen.add(id)
        const s = inst.status
        const key = s ? `${s.state}|${s.exit_code ?? ''}|${s.message ?? ''}` : 'PROCESS_STATE_EXITED||'
        const existing = next[id]
        if (!existing) next[id] = { key, updated_at_unix_ms: now }
        else if (existing.key !== key) next[id] = { key, updated_at_unix_ms: now }
      }

      for (const id of Object.keys(next)) {
        if (!seen.has(id)) delete next[id]
      }

      return next
    })
  })

  function instanceDisplayName(i: InstanceListItem): string {
    const params = i.config.params as Record<string, unknown> | null | undefined
    const paramName = params?.name
    if (typeof i.config.display_name === 'string' && i.config.display_name.trim()) return i.config.display_name
    if (typeof paramName === 'string' && paramName.trim()) return paramName
    return i.config.instance_id
  }

  function instanceStateForFilter(status: ProcessStatusDto | null): InstanceStatusFilter {
    const s = status?.state ?? 'PROCESS_STATE_EXITED'
    if (s === 'PROCESS_STATE_RUNNING') return 'running'
    if (s === 'PROCESS_STATE_STARTING') return 'starting'
    if (s === 'PROCESS_STATE_STOPPING') return 'stopping'
    if (s === 'PROCESS_STATE_FAILED') return 'failed'
    return 'stopped'
  }

  const instanceTemplateFilterOptions = createMemo(() => {
    const list = (instances.data ?? []) as InstanceListItem[]
    const set = new Set<string>()
    for (const i of list) set.add(i.config.template_id)
    const opts = [{ value: 'all', label: params.t('instances.filters.options.all') }]
    for (const id of Array.from(set).sort()) opts.push({ value: id, label: id })
    return opts
  })

  const instanceSortOptions = createMemo(() => [
    { value: 'updated', label: params.t('instances.filters.sortOption.updated') },
    { value: 'name', label: params.t('instances.filters.sortOption.name') },
    { value: 'status', label: params.t('instances.filters.sortOption.status') },
    { value: 'port', label: params.t('instances.filters.sortOption.port') },
  ])

  const instanceStatusFilterOptions = createMemo(() => [
    { value: 'all', label: params.t('instances.filters.options.all') },
    { value: 'running', label: params.t('instances.filters.statusOption.running') },
    { value: 'starting', label: params.t('instances.filters.statusOption.starting') },
    { value: 'stopping', label: params.t('instances.filters.statusOption.stopping') },
    { value: 'failed', label: params.t('instances.filters.statusOption.failed') },
    { value: 'stopped', label: params.t('instances.filters.statusOption.stopped') },
  ])

  function togglePinnedInstance(id: string) {
    setPinnedInstanceIds((prev) => {
      const next = { ...prev }
      if (next[id]) delete next[id]
      else next[id] = true
      return next
    })
  }

  function compareLabel(aRaw: string, bRaw: string): number {
    const a = aRaw.trim()
    const b = bRaw.trim()
    const aNum = a.length > 0 && a.charCodeAt(0) >= 48 && a.charCodeAt(0) <= 57
    const bNum = b.length > 0 && b.charCodeAt(0) >= 48 && b.charCodeAt(0) <= 57
    if (aNum !== bNum) return aNum ? -1 : 1
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  }

  const filteredInstances = createMemo(() => {
    const list = (instances.data ?? []) as InstanceListItem[]
    const q = instanceSearch()
    const statusFilter = instanceStatusFilter()
    const templateFilter = instanceTemplateFilter()
    const pinned = pinnedInstanceIds()
    const sortKey = instanceSortKey()

    const out = list.filter((i) => {
      if (templateFilter !== 'all' && i.config.template_id !== templateFilter) return false
      const st = instanceStateForFilter(i.status)
      if (statusFilter !== 'all' && st !== statusFilter) return false
      if (!q) return true
      const hay = `${instanceDisplayName(i)} ${i.config.instance_id} ${i.config.template_id}`.toLowerCase()
      return hay.includes(q)
    })

    const statusRank: Record<string, number> = {
      PROCESS_STATE_RUNNING: 5,
      PROCESS_STATE_STARTING: 4,
      PROCESS_STATE_STOPPING: 3,
      PROCESS_STATE_FAILED: 2,
      PROCESS_STATE_EXITED: 1,
    }

    out.sort((a, b) => {
      const ap = pinned[a.config.instance_id] ? 1 : 0
      const bp = pinned[b.config.instance_id] ? 1 : 0
      if (ap !== bp) return bp - ap

      if (sortKey === 'name') return compareLabel(instanceDisplayName(a), instanceDisplayName(b))
      if (sortKey === 'port') {
        const aPort = instancePort(a) ?? 0
        const bPort = instancePort(b) ?? 0
        if (aPort !== bPort) return aPort - bPort
        return compareLabel(instanceDisplayName(a), instanceDisplayName(b))
      }
      if (sortKey === 'status') {
        const ar = statusRank[a.status?.state ?? 'PROCESS_STATE_EXITED'] ?? 0
        const br = statusRank[b.status?.state ?? 'PROCESS_STATE_EXITED'] ?? 0
        if (ar !== br) return br - ar
        return compareLabel(instanceDisplayName(a), instanceDisplayName(b))
      }

      const au = instanceStatusKeys()[a.config.instance_id]?.updated_at_unix_ms ?? 0
      const bu = instanceStatusKeys()[b.config.instance_id]?.updated_at_unix_ms ?? 0
      if (au !== bu) return bu - au
      return compareLabel(instanceDisplayName(a), instanceDisplayName(b))
    })
    return out
  })

  async function invalidateInstances() {
    await queryClient.invalidateQueries({ queryKey: ['instance.list', null] })
  }

  return {
    activeInstanceViewPresetId,
    applyInstanceViewPreset,
    deleteInstanceViewPreset,
    filteredInstances,
    instanceCompact,
    instanceDisplayName,
    instanceViewPresets,
    instanceSearchInput,
    instanceSortKey,
    instanceSortOptions,
    instanceStatusFilter,
    instanceStatusFilterOptions,
    instanceStatusKeys,
    instanceTemplateFilter,
    instanceTemplateFilterOptions,
    instances,
    instancesLastUpdatedAtUnixMs,
    instancesPollErrorStreak,
    invalidateInstances,
    pinnedInstanceIds,
    setInstanceSearch,
    setInstanceSearchInput,
    setInstanceSortKey,
    setInstanceStatusFilter,
    setInstanceTemplateFilter,
    saveInstanceViewPreset,
    togglePinnedInstance,
  }
}
