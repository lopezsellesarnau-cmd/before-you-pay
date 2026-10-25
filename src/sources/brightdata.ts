import { fetchWithFallback } from './http.ts';

// Google Lens through Bright Data's SERP API: where else on the web does this photo appear?
// https://docs.brightdata.com/scraping-automation/serp-api/query-parameters/google (Lens)

export interface LensMatch {
  title: string;
  link: string;
  domain: string;
}

export interface LensResult {
  imageUrl: string;
  lensUrl: string;
  matches: LensMatch[];
  live: boolean;
  retrievedAt: string;
}

export const brightdataConfigured = () => !!(process.env.BRIGHTDATA_API_TOKEN && process.env.BRIGHTDATA_SERP_ZONE);

export async function lens(imageUrl: string): Promise<LensResult> {
  const lensUrl = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}&brd_lens=exact_matches`;
  const r = await fetchWithFallback(
    'https://api.brightdata.com/request',
    { authorization: `Bearer ${process.env.BRIGHTDATA_API_TOKEN ?? ''}`, 'content-type': 'application/json' },
    JSON.stringify({ zone: process.env.BRIGHTDATA_SERP_ZONE, url: lensUrl, format: 'json', data_format: 'parsed' }),
    lensUrl, // same saved copy whatever the zone, so the offline demo works for anyone
  );
  // Bright Data wraps Google's answer: { status_code, headers, body: "<parsed JSON as text>" }.
  const wrapper = JSON.parse(r.body);
  if (wrapper.status_code && wrapper.status_code !== 200) throw new Error(`lens: HTTP ${wrapper.status_code} ${wrapper.headers?.['x-brd-error'] ?? ''}`.trim());
  const inner = typeof wrapper.body === 'string' ? wrapper.body : JSON.stringify(wrapper.body ?? wrapper);
  return { imageUrl, lensUrl, matches: parseLens(inner), live: r.live, retrievedAt: r.retrievedAt };
}

/**
 * Parsed Lens JSON has `images[]` and `organic[]` with title, link and source. Fields are not
 * documented as fixed, so take every object with a web link and a title wherever it sits,
 * and drop Google's own pages (the tabs).
 */
export function parseLens(body: string): LensMatch[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return [];
  }
  const out = new Map<string, LensMatch>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const link = [o.link, o.url, o.source_url, o.page_url].find((x): x is string => typeof x === 'string' && /^https?:\/\//.test(x));
    const title = [o.title, o.name, o.snippet].find((x): x is string => typeof x === 'string' && x.trim().length > 0);
    // Links come as lens.google.com/goto redirects; the site is in display_link or source.
    const site = [o.display_link, o.source].find((x): x is string => typeof x === 'string' && x.trim().length > 0);
    if (link && title) {
      const host = new URL(link).hostname.replace(/^www\./, '');
      const google = /(^|\.)google\.|gstatic\.com$|googleusercontent\.com$/.test(host);
      const domain = google ? site && hostOf(site) : host;
      if (domain && !out.has(link)) out.set(link, { title: title.trim(), link, domain });
    }
    Object.values(o).forEach(walk);
  };
  walk(json);
  return [...out.values()];
}

/** "https://www.airbnb.es/rooms/1" → "airbnb.es"; a plain name such as "OLX" is kept, lowercased. */
function hostOf(site: string) {
  const s = site.trim().toLowerCase().split(/\s/)[0];
  try {
    return new URL(/^https?:\/\//.test(s) ? s : `https://${s.split('/')[0]}`).hostname.replace(/^www\./, '');
  } catch {
    return s;
  }
}
