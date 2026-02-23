#!/usr/bin/env node

import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const distDir = path.resolve(process.cwd(), 'dist')
const warningBytes = Number(process.env.WEB_BUNDLE_WARNING_BYTES ?? 350 * 1024)
const hardFailBytes = Number(process.env.WEB_BUNDLE_FAIL_BYTES ?? 0)
const maxAssets = Number(process.env.WEB_BUNDLE_MAX_ASSETS ?? 12)
const acceptedPrefixes = ['assets/index-']

const formatKiB = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await listFiles(full)
      files.push(...nested)
      continue
    }
    if (entry.isFile()) {
      files.push(full)
    }
  }
  return files
}

function isPrimaryAsset(relPath) {
  return acceptedPrefixes.some((prefix) => relPath.startsWith(prefix))
}

async function main() {
  const files = await listFiles(distDir)
  const assetFiles = []

  for (const file of files) {
    const rel = path.relative(distDir, file).replaceAll('\\', '/')
    if (!rel.startsWith('assets/')) continue
    const info = await stat(file)
    assetFiles.push({ rel, size: info.size })
  }

  if (assetFiles.length === 0) {
    throw new Error('No build assets found in dist/assets.')
  }

  const primaryAssets = assetFiles.filter((asset) => isPrimaryAsset(asset.rel))

  if (primaryAssets.length === 0) {
    throw new Error('No primary index assets found in dist/assets.')
  }

  const totalBytes = primaryAssets.reduce((sum, file) => sum + file.size, 0)
  const oversized = primaryAssets.filter((file) => file.size > warningBytes)
  const hardFailEnabled = Number.isFinite(hardFailBytes) && hardFailBytes > 0
  const overHardFail = hardFailEnabled ? primaryAssets.filter((file) => file.size > hardFailBytes) : []

  const report = [
    '[bundle-check] primary assets:',
    ...primaryAssets
      .sort((a, b) => b.size - a.size)
      .map((file) => `- ${file.rel}: ${formatKiB(file.size)}`),
    `[bundle-check] total primary assets: ${formatKiB(totalBytes)} (${primaryAssets.length} files)`,
    `[bundle-check] warning threshold: ${formatKiB(warningBytes)}`,
    hardFailEnabled
      ? `[bundle-check] hard-fail threshold: ${formatKiB(hardFailBytes)}`
      : '[bundle-check] hard-fail threshold: disabled',
  ]

  console.log(report.join('\n'))

  if (primaryAssets.length > maxAssets) {
    throw new Error(`Primary asset count ${primaryAssets.length} exceeds max ${maxAssets}.`)
  }

  if (hardFailEnabled && overHardFail.length > 0) {
    const details = overHardFail.map((file) => `${file.rel}=${formatKiB(file.size)}`).join(', ')
    throw new Error(`Hard-fail size threshold exceeded: ${details}`)
  }

  if (oversized.length > 0) {
    const details = oversized.map((file) => `${file.rel}=${formatKiB(file.size)}`).join(', ')
    console.warn(`[bundle-check] warning: threshold exceeded for ${details}`)
  }

  const indexPath = path.join(distDir, 'index.html')
  const indexHtml = await readFile(indexPath, 'utf8')
  if (!indexHtml.includes('assets/index-')) {
    throw new Error('dist/index.html does not reference hashed index assets.')
  }

  console.log('[bundle-check] completed')
}

main().catch((error) => {
  console.error('[bundle-check] failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
