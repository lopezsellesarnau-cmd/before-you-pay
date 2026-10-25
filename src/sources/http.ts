import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE_DIR = fileURLToPath(new URL('../../data/cache/', import.meta.url));

export interface Fetched {
  body: string;
  live: boolean;
  retrievedAt: string;
}

/**
 * GET with a disk cache used only as a fallback. Every successful live answer is saved;
 * when the service is down (or OFFLINE=1) the last saved answer is served with live=false,
 * and the critic downgrades whatever was built on it.
 */
export async function fetchWithFallback(url: string, headers: Record<string, string> = {}, payload?: string, cacheKey?: string): Promise<Fetched> {
  // POST when there is a payload. The cache key is the URL, or `cacheKey` when the payload
  // carries account details (never the headers, which hold keys).
  const file = join(CACHE_DIR, createHash('sha1').update(cacheKey ?? (payload ? `${url}\n${payload}` : url)).digest('hex').slice(0, 16) + '.json');
  if (process.env.OFFLINE !== '1') {
    try {
      const res = await fetch(url, { method: payload ? 'POST' : 'GET', headers, body: payload, signal: AbortSignal.timeout(payload ? 60_000 : 15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      const retrievedAt = new Date().toISOString();
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(file, JSON.stringify({ url, retrievedAt, body }));
      return { body, live: true, retrievedAt };
    } catch {
      // fall through to the cache
    }
  }
  try {
    const cached = JSON.parse(await readFile(file, 'utf8'));
    return { body: cached.body, live: false, retrievedAt: cached.retrievedAt };
  } catch {
    throw new Error(`unreachable and not cached: ${url}`);
  }
}
