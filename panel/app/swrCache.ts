type CacheEntry<T> = {
  value: T;
  atMs: number;
  ttlMs: number;
};

const cache = new Map<string, CacheEntry<any>>();
const inflight = new Map<string, Promise<any>>();

export function swrPeek<T>(keyRaw: string, ttlMs: number): { value: T; stale: boolean; ageMs: number } | null {
  const key = String(keyRaw || "");
  if (!key) return null;
  const entry = cache.get(key);
  if (!entry) return null;
  const ageMs = Math.max(0, Date.now() - entry.atMs);
  const ttl = Math.max(0, Math.round(Number(ttlMs || 0)));
  return { value: entry.value as T, stale: ttl > 0 ? ageMs > ttl : true, ageMs };
}

export function swrPut<T>(keyRaw: string, value: T, ttlMs: number): void {
  const key = String(keyRaw || "");
  if (!key) return;
  cache.set(key, { value, atMs: Date.now(), ttlMs: Math.max(0, Math.round(Number(ttlMs || 0))) });
}

export function swrInvalidate(prefixRaw: string): void {
  const prefix = String(prefixRaw || "");
  if (!prefix) return;
  for (const key of cache.keys()) {
    if (key === prefix || key.startsWith(prefix)) cache.delete(key);
  }
}

export async function swrRevalidate<T>(keyRaw: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const key = String(keyRaw || "");
  if (!key) return await fetcher();

  const existing = inflight.get(key);
  if (existing) return (await existing) as T;

  const p = (async () => {
    const value = await fetcher();
    swrPut(key, value, ttlMs);
    return value;
  })();
  inflight.set(key, p);
  try {
    return (await p) as T;
  } finally {
    if (inflight.get(key) === p) inflight.delete(key);
  }
}

