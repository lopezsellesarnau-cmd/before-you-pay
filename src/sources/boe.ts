import { XMLParser } from 'fast-xml-parser';
import { fetchWithFallback } from './http.ts';

// BOE open data API: consolidated text of the LAU, one article per request, with every
// historical version. We take the version in force today.
export const LAU_ID = 'BOE-A-1994-26003';

export interface Article {
  id: string;
  title: string;
  /** Paragraphs of the version in force, numbered as in the BOE. */
  paragraphs: string[];
  /** BOE id of the norm that last changed it, e.g. RDL 29/2026. */
  amendedBy: string;
  inForceSince: string;
  url: string;
  humanUrl: string;
  live: boolean;
  retrievedAt: string;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', textNodeName: '#text' });

export async function lauArticle(n: number, today = new Date()): Promise<Article> {
  const url = `https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/${LAU_ID}/texto/bloque/a${n}`;
  const { body, live, retrievedAt } = await fetchWithFallback(url, { Accept: 'application/xml' });
  const block = parser.parse(body).response.data.bloque;
  const versions = [block.version].flat();
  const ymd = today.toISOString().slice(0, 10).replaceAll('-', '');
  const current = versions.filter((v: any) => String(v.fecha_vigencia) <= ymd).at(-1) ?? versions.at(-1);

  const paras: string[] = [current.p]
    .flat()
    .filter((p: any) => p && (typeof p === 'string' || p.class !== 'nota_pie'))
    .map((p: any) => text(p).replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return {
    id: `a${n}`,
    title: paras[0],
    paragraphs: paras.slice(1),
    amendedBy: current.id_norma,
    inForceSince: fmt(String(current.fecha_vigencia)),
    url,
    humanUrl: `https://www.boe.es/buscar/act.php?id=${LAU_ID}#a${n}`,
    live,
    retrievedAt,
  };
}

/** Numbered paragraph ("5.") plus the unnumbered lines that continue it. */
export function paragraph(a: Article, num: number): string | undefined {
  const start = a.paragraphs.findIndex((p) => p.startsWith(`${num}.`));
  if (start < 0) return undefined;
  const out = [a.paragraphs[start]];
  for (const p of a.paragraphs.slice(start + 1)) {
    if (/^\d+\./.test(p)) break;
    out.push(p);
  }
  return out.join(' ');
}

/** The sentence of an article that contains `needle`, for verbatim citation. */
export function sentence(a: Article, needle: string): string | undefined {
  for (const p of a.paragraphs) {
    const hit = p.split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚ])/).find((s) => s.includes(needle));
    if (hit) return hit;
  }
}

function text(node: any): string {
  if (node == null) return '';
  if (typeof node !== 'object') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  return Object.entries(node)
    .filter(([k]) => k !== 'class')
    .map(([, v]) => text(v))
    .join(' ');
}

function fmt(ymd: string) {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}
