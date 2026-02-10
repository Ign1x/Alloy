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
  if (kind === 'palworld') return 'Palworld'
  if (kind === 'factorio') return 'Factorio'
  if (kind === 'core_keeper') return 'Core Keeper'
  if (kind === 'seven_days') return '7 Days to Die'
  if (kind === 'the_forest') return 'The Forest'
  if (kind === 'sons_of_the_forest') return 'Sons of the Forest'
  if (kind === 'demo') return 'Demo'
  return titleCase(kind)
}

export function templateLogoSrc(templateId: string): string | undefined {
  const kind = templateKind(templateId)
  if (kind === 'minecraft') return 'https://external-content.duckduckgo.com/ip3/www.minecraft.net.ico'
  if (kind === 'terraria') return 'https://external-content.duckduckgo.com/ip3/www.terraria.org.ico'
  if (kind === 'dst') return 'https://external-content.duckduckgo.com/ip3/dontstarve.fandom.com.ico'
  if (kind === 'palworld') return 'https://external-content.duckduckgo.com/ip3/pocketpair.jp.ico'
  if (kind === 'factorio') return 'https://external-content.duckduckgo.com/ip3/www.factorio.com.ico'
  if (kind === 'core_keeper') return 'https://external-content.duckduckgo.com/ip3/core-keeper.fandom.com.ico'
  if (kind === 'seven_days') return 'https://external-content.duckduckgo.com/ip3/7daystodie.fandom.com.ico'
  if (kind === 'the_forest') return 'https://upload.wikimedia.org/wikipedia/commons/d/d9/The_Forest_game.png'
  if (kind === 'sons_of_the_forest') return 'https://external-content.duckduckgo.com/ip3/sonsoftheforest.fandom.com.ico'
  return undefined
}
