import type { ProcessStatusDto } from '../../bindings'

type InstanceCardBackdrop = {
  src: string
  position: string
}

function templateKind(templateId: string): string {
  const i = templateId.indexOf(':')
  return i >= 0 ? templateId.slice(0, i) : templateId
}

export function instanceCardBackdrop(templateId: string): InstanceCardBackdrop | null {
  const kind = templateKind(templateId)
  if (kind === 'minecraft') return { src: '/game-backdrops/minecraft-bg.jpg', position: '66% 52%' }
  if (kind === 'dst') return { src: '/game-backdrops/dst-bg.jpg', position: '82% 56%' }
  if (kind === 'terraria') return { src: '/game-backdrops/terraria-bg.jpg', position: '80% 58%' }
  if (kind === 'palworld') return { src: '/game-backdrops/terraria-bg.jpg', position: '72% 52%' }
  if (kind === 'factorio') return { src: '/game-backdrops/minecraft-bg.jpg', position: '60% 50%' }
  if (kind === 'demo') return { src: '/game-backdrops/demo-bg.svg', position: '50% 52%' }
  return null
}

export function instanceStateLabel(status: ProcessStatusDto | null) {
  if (!status) return 'Stopped'
  switch (status.state) {
    case 'PROCESS_STATE_STARTING':
      return 'Starting'
    case 'PROCESS_STATE_RUNNING':
      return 'Running'
    case 'PROCESS_STATE_STOPPING':
      return 'Stopping'
    case 'PROCESS_STATE_EXITED':
      return 'Stopped'
    case 'PROCESS_STATE_FAILED':
      return 'Failed'
    default:
      return status.state
  }
}

export function canStartInstance(status: ProcessStatusDto | null) {
  if (!status) return true
  return status.state === 'PROCESS_STATE_EXITED' || status.state === 'PROCESS_STATE_FAILED'
}

export function isStopping(status: ProcessStatusDto | null) {
  return status?.state === 'PROCESS_STATE_STOPPING'
}

export function startProgressSteps(templateId: string): string[] {
  if (templateId === 'minecraft:vanilla') return ['Resolve', 'Download', 'Spawn', 'Wait']
  if (templateId === 'minecraft:modrinth') return ['Resolve', 'Download', 'Install', 'Spawn', 'Wait']
  if (templateId === 'minecraft:import') return ['Import', 'Extract', 'Spawn', 'Wait']
  if (templateId === 'minecraft:curseforge') return ['Resolve', 'Download', 'Extract', 'Spawn', 'Wait']
  if (templateId === 'terraria:vanilla') return ['Resolve', 'Download', 'Extract', 'Spawn', 'Wait']
  if (templateId === 'palworld:vanilla') return ['Install', 'Spawn', 'Wait']
  if (templateId === 'factorio:vanilla') return ['Resolve', 'Download', 'Extract', 'Spawn', 'Wait']
  if (templateId === 'core_keeper:vanilla') return ['Install', 'Spawn', 'Wait']
  if (templateId === 'seven_days:vanilla') return ['Install', 'Spawn', 'Wait']
  if (templateId === 'the_forest:vanilla') return ['Install', 'Spawn', 'Wait']
  if (templateId === 'sons_of_the_forest:vanilla') return ['Install', 'Spawn', 'Wait']
  return ['Spawn', 'Wait']
}

export function startProgressIndex(templateId: string, message: string): number {
  const m = message.toLowerCase()
  const steps = startProgressSteps(templateId)

  const find = (label: string) => steps.findIndex((s) => s.toLowerCase() === label)
  const clamp = (idx: number) => Math.max(0, Math.min(steps.length - 1, idx))

  if (m.includes('import')) return clamp(find('import'))
  if (m.includes('resolve')) return clamp(find('resolve'))
  if (m.includes('download')) return clamp(find('download'))
  if (m.includes('install')) return clamp(find('install'))
  if (m.includes('extract')) return clamp(find('extract'))
  if (m.includes('spawn')) return clamp(find('spawn'))
  if (m.includes('wait')) return clamp(find('wait'))
  return 0
}
