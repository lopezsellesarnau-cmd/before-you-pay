import { existsSync, readFileSync } from 'node:fs';
import { sql, zetarisConfigured } from './zetaris.ts';

// SERPAVI reference rents. Main path: Zetaris, which federates our Postgres (byp_pg).
// Fallback, when Zetaris is not configured or does not answer: the prepared CSV on disk,
// or the small committed sample (real SERPAVI rows for Madrid) so the demo runs anywhere.

export interface RentReference {
  areaCode: string;
  level: 'distrito_censal' | 'municipio';
  areaName: string;
  year: number;
  dwelling: 'colectiva' | 'unifamiliar';
  p25: number;
  p50: number;
  p75: number;
  sampleN: number;
  via: 'zetaris' | 'local-csv' | 'sample-csv';
}

const COLS = 'area_code, area_level, area_name, year, dwelling, eur_m2_p25, eur_m2_p50, eur_m2_p75, sample_n';
const FULL_CSV = new URL('../../data/serpavi/serpavi_long.csv', import.meta.url).pathname;
const SAMPLE_CSV = new URL('../../data/sample/serpavi_sample.csv', import.meta.url).pathname;

/** Latest reference for the area codes, most specific first. */
export async function reference(codes: string[], dwelling: RentReference['dwelling']): Promise<{ ref?: RentReference; error?: string }> {
  let error: string | undefined;
  if (zetarisConfigured()) {
    try {
      const list = codes.map((c) => `'${c.replace(/\D/g, '')}'`).join(',');
      const r = await sql(
        `SELECT ${COLS} FROM byp_pg.serpavi_rent WHERE area_code IN (${list}) AND dwelling = '${dwelling}' ORDER BY year DESC`,
      );
      const rows = r.data.map((d: string[]) => Object.fromEntries(r.headers.map((h: string, i: number) => [h, d[i]])));
      return { ref: pick(rows, codes, 'zetaris') };
    } catch (e) {
      error = `zetaris: ${(e as Error).message}`;
    }
  } else {
    error = 'zetaris not configured';
  }
  const file = existsSync(FULL_CSV) ? FULL_CSV : SAMPLE_CSV;
  const rows = readCsv(file).filter((r) => codes.includes(r.area_code) && r.dwelling === dwelling);
  return { ref: pick(rows, codes, file === FULL_CSV ? 'local-csv' : 'sample-csv'), error };
}

function pick(rows: Record<string, string>[], codes: string[], via: RentReference['via']): RentReference | undefined {
  for (const code of codes) {
    const r = rows.filter((x) => x.area_code === code).sort((a, b) => Number(b.year) - Number(a.year))[0];
    if (r)
      return {
        areaCode: r.area_code,
        level: r.area_level as RentReference['level'],
        areaName: r.area_name,
        year: Number(r.year),
        dwelling: r.dwelling as RentReference['dwelling'],
        p25: round(r.eur_m2_p25),
        p50: round(r.eur_m2_p50),
        p75: round(r.eur_m2_p75),
        sampleN: Number(r.sample_n),
        via,
      };
  }
}

function readCsv(file: string): Record<string, string>[] {
  const [head, ...lines] = readFileSync(file, 'utf8').trim().split('\n');
  const cols = head.split(',');
  return lines.map((l) => Object.fromEntries(splitCsv(l).map((v, i) => [cols[i], v])));
}

/** One CSV line; names such as "Palmas de Gran Canaria, Las" come quoted. */
function splitCsv(line: string): string[] {
  return [...line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g)].map((m) => (m[1] ?? m[2]).replace(/""/g, '"'));
}

const round = (s: string) => Math.round(Number(s) * 100) / 100;
