import type { BadgeVariant } from '../../components/ui/Badge'

type NodeHealthLike = {
  last_error: string | null
  last_seen_at: string | null
}

export type NodeHealthStatus = 'healthy' | 'error' | 'unknown'

export function nodeHealthStatus(node: NodeHealthLike): NodeHealthStatus {
  if (node.last_error) return 'error'
  if (node.last_seen_at) return 'healthy'
  return 'unknown'
}

export function nodeHealthBadgeVariant(status: NodeHealthStatus): BadgeVariant {
  if (status === 'healthy') return 'success'
  if (status === 'error') return 'danger'
  return 'neutral'
}

export function nodeHealthLabelKey(status: NodeHealthStatus): 'nodes.healthy' | 'nodes.error' | 'nodes.unknown' {
  if (status === 'healthy') return 'nodes.healthy'
  if (status === 'error') return 'nodes.error'
  return 'nodes.unknown'
}
