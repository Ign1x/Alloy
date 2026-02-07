function templateKind(templateId: string): string {
  const value = templateId.trim()
  const idx = value.indexOf(':')
  return idx >= 0 ? value.slice(0, idx) : value
}

function titleCase(value: string): string {
  if (!value) return 'Template'
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

export function templateDisplayLabel(templateId: string): string {
  const kind = templateKind(templateId)
  if (kind === 'minecraft') return 'Minecraft'
  if (kind === 'terraria') return 'Terraria'
  if (kind === 'dst') return "Don't Starve Together"
  if (kind === 'demo') return 'Demo'
  return titleCase(kind)
}

export function templateLogoSrc(templateId: string): string | undefined {
  const kind = templateKind(templateId)
  if (kind === 'minecraft') return 'https://external-content.duckduckgo.com/ip3/www.minecraft.net.ico'
  if (kind === 'terraria') return 'https://external-content.duckduckgo.com/ip3/www.terraria.org.ico'
  if (kind === 'dst') return 'https://external-content.duckduckgo.com/ip3/dontstarve.fandom.com.ico'
  return undefined
}
