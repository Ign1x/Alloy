import { createEffect, createMemo, createSignal } from 'solid-js'

import {
  appLocaleShortLabel,
  APP_LOCALE_OPTIONS,
  readAppLocalePreference,
  translate,
  translateLooseText,
  writeAppLocalePreference,
  type AppLocale,
  type I18nKey,
  type I18nParams,
} from '../i18n'

const ATTR_KEYS = ['title', 'placeholder', 'aria-label'] as const
const SKIP_SELECTOR = 'pre, code, textarea, script, style, [data-no-auto-translate]'
const NON_EN_LOCALES: ReadonlyArray<Exclude<AppLocale, 'en'>> = ['zh-CN', 'zh-TW', 'ja']
const FULL_SYNC_BATCH_SIZE = 320

const textOriginalByNode = new WeakMap<Text, string>()
const attrOriginalByEl = new WeakMap<Element, Record<string, string>>()

function shouldSkipTextNode(node: Text): boolean {
  const parent = node.parentElement
  if (!parent) return false
  return Boolean(parent.closest(SKIP_SELECTOR))
}

function isKnownTranslatedVariant(original: string, current: string): boolean {
  for (const testLocale of NON_EN_LOCALES) {
    if (translateLooseText(testLocale, original) === current) return true
  }
  return false
}

function syncTextNode(node: Text, locale: AppLocale): void {
  if (shouldSkipTextNode(node)) return

  const current = node.nodeValue ?? ''
  if (!current.trim()) return

  const original = textOriginalByNode.get(node)

  if (locale === 'en') {
    if (typeof original === 'string') {
      if (current !== original) node.nodeValue = original
      return
    }
    textOriginalByNode.set(node, current)
    return
  }

  if (typeof original !== 'string') {
    textOriginalByNode.set(node, current)
  } else {
    const translatedOriginal = translateLooseText(locale, original)
    if (current !== translatedOriginal && current !== original && !isKnownTranslatedVariant(original, current)) {
      textOriginalByNode.set(node, current)
    }
  }

  const source = textOriginalByNode.get(node) ?? current
  const translated = translateLooseText(locale, source)
  if (translated !== current) node.nodeValue = translated
}

function getAttrStore(el: Element): Record<string, string> {
  const existing = attrOriginalByEl.get(el)
  if (existing) return existing
  const created: Record<string, string> = {}
  attrOriginalByEl.set(el, created)
  return created
}

function syncElementAttrs(el: Element, locale: AppLocale): void {
  if (el.matches(SKIP_SELECTOR) || el.closest(SKIP_SELECTOR)) return

  const store = getAttrStore(el)

  for (const key of ATTR_KEYS) {
    const current = el.getAttribute(key)
    if (current == null || !/[A-Za-z]/.test(current)) continue

    const original = store[key]

    if (locale === 'en') {
      if (typeof original === 'string') {
        if (current !== original) el.setAttribute(key, original)
      } else {
        store[key] = current
      }
      continue
    }

    if (typeof original !== 'string') {
      store[key] = current
    } else {
      const translatedOriginal = translateLooseText(locale, original)
      if (current !== translatedOriginal && current !== original && !isKnownTranslatedVariant(original, current)) {
        store[key] = current
      }
    }

    const source = store[key] ?? current
    const translated = translateLooseText(locale, source)
    if (translated !== current) el.setAttribute(key, translated)
  }
}

function shouldQueueNode(node: Node | null | undefined): node is Node {
  if (!node) return false
  return node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE
}

export function useAppLocale() {
  const [locale, setLocaleSignal] = createSignal<AppLocale>(readAppLocalePreference())

  const setLocale = (next: AppLocale | ((prev: AppLocale) => AppLocale)) => {
    setLocaleSignal((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next
      writeAppLocalePreference(resolved)
      return resolved
    })
  }

  const t = (key: I18nKey, params?: I18nParams) => translate(locale(), key, params)

  const localeShort = createMemo(() => appLocaleShortLabel(locale()))

  createEffect(() => {
    const value = locale()
    try {
      document.documentElement.lang = value
    } catch {
      // ignore
    }
  })

  createEffect(() => {
    const currentLocale = locale()
    const root = document.body
    if (!root) return

    let stopped = false
    let frameId: number | null = null
    const queue: Node[] = []
    const queued = new WeakSet<Node>()

    const enqueue = (node: Node | null | undefined) => {
      if (stopped || !shouldQueueNode(node)) return
      if (queued.has(node)) return
      queued.add(node)
      queue.push(node)
    }

    const processNode = (node: Node) => {
      queued.delete(node)

      if (node.nodeType === Node.TEXT_NODE) {
        syncTextNode(node as Text, currentLocale)
        return
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element
        if (el.matches(SKIP_SELECTOR)) return
        syncElementAttrs(el, currentLocale)
        for (const child of Array.from(el.childNodes)) enqueue(child)
        return
      }

      if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        for (const child of Array.from((node as DocumentFragment).childNodes)) enqueue(child)
      }
    }

    const drain = () => {
      frameId = null
      if (stopped) return

      let processed = 0
      while (queue.length > 0 && processed < FULL_SYNC_BATCH_SIZE) {
        processNode(queue.shift()!)
        processed += 1
      }

      if (queue.length > 0 && !stopped) {
        frameId = requestAnimationFrame(drain)
      }
    }

    const scheduleDrain = () => {
      if (stopped) return
      if (frameId != null) return
      frameId = requestAnimationFrame(drain)
    }

    enqueue(root)
    scheduleDrain()

    const observer = new MutationObserver((mutations) => {
      if (stopped) return

      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          enqueue(mutation.target)
          continue
        }

        if (mutation.type === 'childList') {
          for (const added of mutation.addedNodes) enqueue(added)
        }
      }

      scheduleDrain()
    })

    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [...ATTR_KEYS],
    })

    return () => {
      stopped = true
      observer.disconnect()
      if (frameId != null) cancelAnimationFrame(frameId)
      queue.length = 0
    }
  })

  return {
    locale,
    setLocale,
    localeOptions: APP_LOCALE_OPTIONS,
    localeShort,
    t,
  }
}
