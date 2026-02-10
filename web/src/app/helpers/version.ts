export type SimpleVersion = {
  major: number
  minor: number
  patch: number
}

export function parseSimpleVersion(raw: string | null | undefined): SimpleVersion | null {
  if (!raw) return null
  const value = raw.trim().replace(/^v/i, '')
  if (!value) return null

  const parts = value.split(/[.+-]/)
  if (parts.length < 3) return null

  const major = Number.parseInt(parts[0] ?? '', 10)
  const minor = Number.parseInt(parts[1] ?? '', 10)
  const patch = Number.parseInt(parts[2] ?? '', 10)
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null

  return { major, minor, patch }
}

export function compareSimpleVersion(a: SimpleVersion, b: SimpleVersion): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1
  return 0
}

export function isVersionLower(currentRaw: string | null | undefined, targetRaw: string | null | undefined): boolean | null {
  const current = parseSimpleVersion(currentRaw)
  const target = parseSimpleVersion(targetRaw)
  if (!current || !target) return null
  return compareSimpleVersion(current, target) < 0
}
