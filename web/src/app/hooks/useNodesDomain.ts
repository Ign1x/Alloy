import { createEffect, createMemo, createSignal } from 'solid-js'

import { queryClient, rspc } from '../../rspc'
import {
  compactAllocatablePortsSpec,
  defaultControlWsUrl,
  detectFrpConfigFormat,
  formatLatencyMs,
  parseFrpEndpoint,
} from '../helpers/network'
import { isVersionLower } from '../helpers/version'
import type { I18nTranslate } from '../i18n'
import type { UiTab } from '../types'

export type NodeDto = {
  id: string
  name: string
  endpoint: string
  public_ip?: string | null
  private_ip?: string | null
  enabled: boolean
  last_seen_at: string | null
  agent_version: string | null
  last_error: string | null
  cpu_percent_x100?: number | null
  memory_used_bytes?: string | null
  memory_total_bytes?: string | null
  network_rx_bytes_per_sec?: string | null
  network_tx_bytes_per_sec?: string | null
  disk_read_bytes_per_sec?: string | null
  disk_write_bytes_per_sec?: string | null
  has_connect_token?: boolean
}

export type NodeCreateResult = {
  node: NodeDto
  connect_token: string
  watchtower_token: string
}

export type FrpNodeDto = {
  id: string
  name: string
  server_addr: string | null
  server_port: number | null
  allocatable_ports: string | null
  token: string | null
  config: string
  latency_ms: number | null
  created_at: string
  updated_at: string
}

type UseNodesDomainParams = {
  isAuthed: () => boolean
  me: () => { is_admin?: boolean } | null
  tab: () => UiTab
  t: I18nTranslate
  updateCheck: { data?: { agent_latest?: { version?: string | null; tag?: string | null } | null } | null }
  controlDiagnostics: { data?: { suggested_control_ws_url?: string | null } | null }
}

export function useNodesDomain(params: UseNodesDomainParams) {
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null)

  const nodes = rspc.createQuery(
    () => ['node.list', null],
    () => ({
      enabled: params.isAuthed() && (params.tab() === 'nodes' || params.tab() === 'instances' || Boolean(params.me()?.is_admin)),
      refetchInterval:
        params.isAuthed() && (params.tab() === 'nodes' || params.tab() === 'instances')
          ? 5000
          : params.isAuthed() && Boolean(params.me()?.is_admin)
            ? 30_000
            : false,
      refetchOnWindowFocus: false,
    }),
  )

  const [nodesLastUpdatedAtUnixMs, setNodesLastUpdatedAtUnixMs] = createSignal<number | null>(null)
  createEffect(() => {
    if (!nodes.data) return
    setNodesLastUpdatedAtUnixMs(Date.now())
  })

  const setNodeEnabled = rspc.createMutation(() => 'node.setEnabled')
  const deleteNode = rspc.createMutation(() => 'node.delete')
  const triggerNodeSelfUpdate = rspc.createMutation(() => 'node.triggerSelfUpdate')
  const nodeSelfUpdateStatus = rspc.createQuery(
    () => [
      'node.selfUpdateStatus',
      {
        node_id: selectedNodeId() ?? '',
      },
    ],
    () => ({
      enabled: params.isAuthed() && Boolean(params.me()?.is_admin) && params.tab() === 'nodes' && Boolean(selectedNodeId()),
      refetchOnWindowFocus: false,
      refetchInterval: params.tab() === 'nodes' && selectedNodeId() ? 10000 : false,
    }),
  )
  const [nodeEnabledOverride, setNodeEnabledOverride] = createSignal<Record<string, boolean>>({})

  const frpNodes = rspc.createQuery(
    () => ['frp.list', null],
    () => ({
      enabled: params.isAuthed(),
      refetchOnWindowFocus: false,
      refetchInterval: params.isAuthed() && params.tab() === 'frp' ? 5000 : false,
    }),
  )
  const frpCreateNode = rspc.createMutation(() => 'frp.create')
  const frpUpdateNode = rspc.createMutation(() => 'frp.update')
  const frpDeleteNode = rspc.createMutation(() => 'frp.delete')

  async function invalidateFrpNodes() {
    await queryClient.invalidateQueries({ queryKey: ['frp.list', null] })
  }

  const frpNodeDropdownOptions = createMemo(() => {
    const list = (frpNodes.data ?? []) as unknown as FrpNodeDto[]
    const out: { value: string; label: string; meta?: string }[] = []
    out.push({
      value: '',
      label: list.length > 0 ? params.t('frp.dropdownSelectNode') : params.t('frp.dropdownNoNodesYet'),
      meta: list.length > 0 ? undefined : params.t('frp.dropdownOpenTabHint'),
    })
    for (const n of list) {
      const endpoint =
        n.server_addr && n.server_port ? `${n.server_addr}:${n.server_port}` : parseFrpEndpoint(n.config)
      const latency = formatLatencyMs(n.latency_ms)
      out.push({ value: n.id, label: n.name, meta: endpoint ? `${endpoint} · ${latency}` : latency })
    }
    return out
  })

  function frpNodeConfigById(nodeId: string): string | null {
    const id = nodeId.trim()
    if (!id) return null
    const list = (frpNodes.data ?? []) as unknown as FrpNodeDto[]
    const n = list.find((x) => x.id === id) ?? null
    if (!n) return null

    const cfg = (n.config ?? '').trim()
    if (cfg) {
      const allocPorts = (n.allocatable_ports ?? '').trim()
      if (!allocPorts) return cfg
      const lines = cfg.split('\n')
      const hasHint = lines.some((line) => {
        const trimmed = line.trim().toLowerCase()
        if (!trimmed) return false
        const body = trimmed.startsWith('#')
          ? trimmed.slice(1).trim()
          : trimmed.startsWith(';')
            ? trimmed.slice(1).trim()
            : trimmed
        return body.startsWith('alloy_alloc_ports') || body.startsWith('allocatable_ports')
      })
      if (hasHint) return cfg
      const idx = lines.findIndex((line) => line.trim().toLowerCase() === '[common]')
      if (idx >= 0) {
        lines.splice(idx + 1, 0, `# alloy_alloc_ports = ${allocPorts}`)
        return lines.join('\n')
      }
      return `${cfg}\n# alloy_alloc_ports = ${allocPorts}`
    }

    if (!n.server_addr || !n.server_port) return null
    const lines = ['[common]', `server_addr = ${n.server_addr}`, `server_port = ${n.server_port}`]
    const token = (n.token ?? '').trim()
    const allocPorts = (n.allocatable_ports ?? '').trim()
    if (token) lines.push(`token = ${token}`)
    if (allocPorts) lines.push(`# alloy_alloc_ports = ${allocPorts}`)
    lines.push('', '[alloy]', 'type = tcp', 'local_ip = 127.0.0.1', 'local_port = 0', 'remote_port = 0')
    return lines.join('\n')
  }

  const createNodeDropdownOptions = createMemo(() => {
    const list = (nodes.data ?? []) as NodeDto[]
    return list
      .filter((n) => n.enabled)
      .map((n) => ({
        value: n.id,
        label: n.name,
        meta: n.endpoint?.trim() || undefined,
      }))
  })

  const [createNodeId, setCreateNodeId] = createSignal('')

  const createSelectedNode = createMemo(() => {
    const id = createNodeId().trim()
    if (!id) return null
    return ((nodes.data ?? []) as NodeDto[]).find((n) => n.id === id) ?? null
  })

  createEffect(() => {
    const id = createNodeId().trim()
    if (!id) return
    const valid = createNodeDropdownOptions().some((opt) => opt.value === id)
    if (!valid) setCreateNodeId('')
  })

  const [showFrpNodeModal, setShowFrpNodeModal] = createSignal(false)
  const [editingFrpNodeId, setEditingFrpNodeId] = createSignal<string | null>(null)
  const [frpNodeName, setFrpNodeName] = createSignal('')
  const [frpNodeServerAddr, setFrpNodeServerAddr] = createSignal('')
  const [frpNodeServerPort, setFrpNodeServerPort] = createSignal('')
  const [frpNodeAllocatablePorts, setFrpNodeAllocatablePorts] = createSignal('')
  const [frpNodeToken, setFrpNodeToken] = createSignal('')
  const [frpNodeTokenVisible, setFrpNodeTokenVisible] = createSignal(false)
  const [frpNodeConfig, setFrpNodeConfig] = createSignal('')
  const [frpNodeFieldErrors, setFrpNodeFieldErrors] = createSignal<Record<string, string>>({})
  const [frpNodeFormError, setFrpNodeFormError] = createSignal<string | null>(null)

  function closeFrpNodeModal() {
    setShowFrpNodeModal(false)
    setEditingFrpNodeId(null)
    setFrpNodeName('')
    setFrpNodeServerAddr('')
    setFrpNodeServerPort('')
    setFrpNodeAllocatablePorts('')
    setFrpNodeToken('')
    setFrpNodeTokenVisible(false)
    setFrpNodeConfig('')
    setFrpNodeFieldErrors({})
    setFrpNodeFormError(null)
  }

  function openCreateFrpNodeModal() {
    setEditingFrpNodeId(null)
    setFrpNodeName('')
    setFrpNodeServerAddr('')
    setFrpNodeServerPort('7000')
    setFrpNodeAllocatablePorts('')
    setFrpNodeToken('')
    setFrpNodeTokenVisible(false)
    setFrpNodeConfig('')
    setFrpNodeFieldErrors({})
    setFrpNodeFormError(null)
    setShowFrpNodeModal(true)
  }

  function openEditFrpNodeModal(node: FrpNodeDto) {
    setEditingFrpNodeId(node.id)
    setFrpNodeName(node.name)
    setFrpNodeServerAddr(node.server_addr ?? '')
    setFrpNodeServerPort(node.server_port != null ? String(node.server_port) : '')
    setFrpNodeAllocatablePorts(compactAllocatablePortsSpec(node.allocatable_ports))
    setFrpNodeToken(node.token ?? '')
    setFrpNodeTokenVisible(false)
    setFrpNodeConfig(node.config)
    setFrpNodeFieldErrors({})
    setFrpNodeFormError(null)
    setShowFrpNodeModal(true)
  }

  const frpNodeDetectedFormat = createMemo(() => detectFrpConfigFormat(frpNodeConfig()))
  const frpNodeCanSave = createMemo(() => {
    if (!frpNodeName().trim()) return false
    if (frpNodeConfig().trim()) return true

    const addr = frpNodeServerAddr().trim()
    const port = Number.parseInt(frpNodeServerPort().trim(), 10)
    return Boolean(addr) && Number.isFinite(port) && port > 0 && port <= 65535
  })

  const createNode = rspc.createMutation(() => 'node.create')
  const [showCreateNodeModal, setShowCreateNodeModal] = createSignal(false)
  const [createNodeName, setCreateNodeName] = createSignal('')
  const defaultCreateNodeControlWsUrl = createMemo(() =>
    defaultControlWsUrl(params.controlDiagnostics.data?.suggested_control_ws_url ?? null),
  )
  const [createNodeControlWsUrl, setCreateNodeControlWsUrl] = createSignal(defaultCreateNodeControlWsUrl())
  const [createNodeFieldErrors, setCreateNodeFieldErrors] = createSignal<Record<string, string>>({})
  const [createNodeFormError, setCreateNodeFormError] = createSignal<string | null>(null)
  const [createNodeResult, setCreateNodeResult] = createSignal<NodeCreateResult | null>(null)

  const createNodeWatchtowerPort = createMemo(() => {
    const nodeId = createNodeResult()?.node?.id ?? ''
    let hash = 0
    for (let i = 0; i < nodeId.length; i++) {
      hash = (hash * 33 + nodeId.charCodeAt(i)) >>> 0
    }
    return 45000 + (hash % 20000)
  })

  const createNodeComposeYaml = createMemo(() => {
    const result = createNodeResult()
    if (!result) return ''
    const rawUrls = createNodeControlWsUrl().trim() || defaultCreateNodeControlWsUrl()
    const parsedUrls = rawUrls
      .split(/[,\s;]+/g)
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
    const wsUrls = parsedUrls.length > 0 ? parsedUrls : [rawUrls]
    const primaryUrl = wsUrls[0]
    const wsUrlsEnv = wsUrls.join(',')
    const name = result.node.name
    const token = result.connect_token
    const watchtowerToken = result.watchtower_token

    return [
      'services:',
      '  alloy-agent:',
      '    image: ghcr.io/ign1x/alloy-agent:latest',
      '    network_mode: "host"',
      '    restart: unless-stopped',
      '    environment:',
      '      - RUST_LOG=info',
      '      - ALLOY_DATA_ROOT=/data',
      '      - ALLOY_FS_WRITE_ENABLED=true',
      `      - ALLOY_CONTROL_WS_URL=${primaryUrl}`,
      `      - ALLOY_CONTROL_WS_URLS=${wsUrlsEnv}`,
      '      - ALLOY_CONTROL_TUNNEL_MODE=poll',
      '      - ALLOY_CONTROL_WS_PING_INTERVAL_MS=5000',
      '      - ALLOY_CONTROL_WS_APP_KEEPALIVE_MS=12000',
      '      - ALLOY_CONTROL_WS_CONNECT_TIMEOUT_MS=15000',
      '      - ALLOY_CONTROL_WS_RECONNECT_MAX_MS=8000',
      `      - ALLOY_NODE_NAME=${name}`,
      `      - ALLOY_NODE_TOKEN=${token}`,
      `      - ALLOY_AGENT_SELF_UPDATE_WATCHTOWER_URL=http://watchtower:${createNodeWatchtowerPort()}`,
      `      - ALLOY_AGENT_SELF_UPDATE_WATCHTOWER_TOKEN=${watchtowerToken}`,
      '    volumes:',
      '      - alloy-agent-data:/data',
      '      - /var/run/docker.sock:/var/run/docker.sock',
      '    labels:',
      '      - "com.centurylinklabs.watchtower.enable=true"',
      '  watchtower:',
      '    image: nickfedor/watchtower:latest',
      '    restart: unless-stopped',
      '    ports:',
      `      - "${createNodeWatchtowerPort()}:8080"`,
      '    volumes:',
      '      - /var/run/docker.sock:/var/run/docker.sock',
      '    environment:',
      '      - WATCHTOWER_LABEL_ENABLE=true',
      '      - WATCHTOWER_HTTP_API_UPDATE=true',
      `      - WATCHTOWER_HTTP_API_TOKEN=${watchtowerToken}`,
      '      - WATCHTOWER_CLEANUP=true',
      '    labels:',
      '      - "com.centurylinklabs.watchtower.enable=false"',
      'volumes:',
      '  alloy-agent-data:',
      '',
    ].join('\n')
  })

  const createNodeInstallCommand = createMemo(() => {
    const compose = createNodeComposeYaml()
    if (!compose) return ''

    const bytes = new TextEncoder().encode(compose)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const b64 = window.btoa(binary)

    return `mkdir -p alloy-node && cd alloy-node && printf '%s' '${b64}' | base64 -d > docker-compose.yml && docker compose up -d`
  })

  function openCreateNode() {
    setCreateNodeName('')
    setCreateNodeControlWsUrl(defaultCreateNodeControlWsUrl())
    setCreateNodeFieldErrors({})
    setCreateNodeFormError(null)
    setCreateNodeResult(null)
    setShowCreateNodeModal(true)
  }

  function closeCreateNode() {
    setShowCreateNodeModal(false)
    setCreateNodeFieldErrors({})
    setCreateNodeFormError(null)
    setCreateNodeResult(null)
  }

  createEffect(() => {
    if (params.tab() !== 'nodes') return
    const list = nodes.data ?? []
    if (!list.length) return
    const current = selectedNodeId()
    if (!current || !list.some((n: { id: string }) => n.id === current)) {
      setSelectedNodeId(list[0].id)
    }
  })

  async function invalidateNodes() {
    await queryClient.invalidateQueries({ queryKey: ['node.list', null] })
  }

  const selectedNode = createMemo(() => {
    const id = selectedNodeId()
    if (!id) return null
    return (nodes.data ?? []).find((n: { id: string }) => n.id === id) ?? null
  })

  const nodeAgentOutdatedCount = createMemo(() => {
    const latest = params.updateCheck.data?.agent_latest
    const target = latest?.version ?? latest?.tag ?? null
    if (!target) return 0

    let count = 0
    for (const node of (nodes.data ?? []) as NodeDto[]) {
      if (isVersionLower(node.agent_version, target) === true) {
        count += 1
      }
    }
    return count
  })

  const nodeCount = createMemo(() => ((nodes.data ?? []) as NodeDto[]).length)

  return {
    closeCreateNode,
    closeFrpNodeModal,
    createNode,
    createNodeComposeYaml,
    createNodeControlWsUrl,
    createNodeId,
    createNodeDropdownOptions,
    createNodeFieldErrors,
    createNodeFormError,
    createNodeInstallCommand,
    createNodeName,
    createNodeResult,
    createSelectedNode,
    defaultCreateNodeControlWsUrl,
    deleteNode,
    editingFrpNodeId,
    frpCreateNode,
    frpDeleteNode,
    frpNodeCanSave,
    frpNodeConfig,
    frpNodeConfigById,
    frpNodeDetectedFormat,
    frpNodeDropdownOptions,
    frpNodeFieldErrors,
    frpNodeFormError,
    frpNodeName,
    frpNodeServerAddr,
    frpNodeServerPort,
    frpNodeAllocatablePorts,
    frpNodeToken,
    frpNodeTokenVisible,
    frpNodes,
    frpUpdateNode,
    invalidateFrpNodes,
    invalidateNodes,
    nodeAgentOutdatedCount,
    nodeCount,
    nodeEnabledOverride,
    nodeSelfUpdateStatus,
    nodes,
    nodesLastUpdatedAtUnixMs,
    openCreateFrpNodeModal,
    openCreateNode,
    openEditFrpNodeModal,
    selectedNode,
    selectedNodeId,
    setCreateNodeControlWsUrl,
    setCreateNodeId,
    setCreateNodeFieldErrors,
    setCreateNodeFormError,
    setCreateNodeName,
    setCreateNodeResult,
    setFrpNodeAllocatablePorts,
    setFrpNodeConfig,
    setFrpNodeFieldErrors,
    setFrpNodeFormError,
    setFrpNodeName,
    setFrpNodeServerAddr,
    setFrpNodeServerPort,
    setFrpNodeToken,
    setFrpNodeTokenVisible,
    setNodeEnabled,
    setNodeEnabledOverride,
    setSelectedNodeId,
    showCreateNodeModal,
    showFrpNodeModal,
    triggerNodeSelfUpdate,
  }
}
