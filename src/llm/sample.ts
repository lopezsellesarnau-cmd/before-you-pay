import type { GenerateRequest } from './provider.ts';

// Sample provider: runs the whole agent with no model and no credentials.
// Extraction is a handful of regexes over Spanish listing phrasing; explanations are
// the deterministic rule outcome restated. Good enough for tests and an offline demo,
// and it obeys the same output contract the real models must.

export async function sampleGenerate(req: GenerateRequest): Promise<string> {
  if (req.task === 'extract') return JSON.stringify(extract(req.prompt.split('"""')[1] ?? ''));
  const outcome = req.prompt.match(/RULE OUTCOME: (.*)/)?.[1] ?? '';
  const ids = [...req.prompt.matchAll(/^\[(f\d+)\]/gm)].map((m) => m[1]);
  return `${outcome} ${ids.map((i) => `[${i}]`).join(' ')}`.trim();
}

const STREET_TYPES: Record<string, string> = {
  calle: 'CL', c: 'CL', avenida: 'AV', avda: 'AV', plaza: 'PZ', pza: 'PZ', paseo: 'PS', ronda: 'RD', travesia: 'TR', travesía: 'TR',
};

function num(s: string) {
  return Number(s.replace(/\./g, '').replace(',', '.'));
}

function extract(text: string) {
  const out: { attribute: string; value: unknown; quote: string }[] = [];
  const add = (attribute: string, re: RegExp, map: (m: RegExpMatchArray) => unknown) => {
    const m = text.match(re);
    if (m) out.push({ attribute, value: map(m), quote: m[0] });
  };

  const addr = text.match(/\b(calle|c\/|avenida|avda\.?|plaza|pza\.?|paseo|ronda|traves[ií]a)\s+(?:de\s+(?:la\s+|los\s+|las\s+)?)?([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)*),?\s+(\d+)/i);
  if (addr) {
    const t = addr[1].toLowerCase().replace(/[\/.]/g, '');
    out.push({ attribute: 'address.street_type', value: STREET_TYPES[t] ?? 'CL', quote: addr[0] });
    out.push({ attribute: 'address.street', value: addr[2].toUpperCase(), quote: addr[0] });
    out.push({ attribute: 'address.number', value: addr[3], quote: addr[0] });
  }
  add('address.floor', /\b(\d{1,2})\s*[ºª°]/, (m) => m[1]);
  add('address.floor', /\bbajo\b/i, () => '0');
  add('address.door', /\b\d{1,2}\s*[ºª°]\s*([A-H]|izq(?:uierda)?|dcha|derecha)\b/i, (m) =>
    m[1].toUpperCase().startsWith('IZQ') ? 'IZQ' : m[1].toUpperCase().startsWith('D') && m[1].length > 1 ? 'DCH' : m[1].toUpperCase(),
  );
  add('address.municipality', /\(([A-ZÁÉÍÓÚ][a-záéíóúñ]+)\)/, (m) => m[1]);
  add('address.province', /\(([A-ZÁÉÍÓÚ][a-záéíóúñ]+)\)/, (m) => m[1]);
  add('unit.area_m2', /(\d{2,4})\s*m(?:²|2)\s*(construidos|útiles|utiles)?/i, (m) => Number(m[1]));
  add('unit.area_kind', /\d{2,4}\s*m(?:²|2)\s*(construidos|útiles|utiles)/i, (m) => m[1].toLowerCase().replace('ú', 'u'));
  add('unit.bedrooms', /(\d)\s*(?:dormitorios|habitaciones)/i, (m) => Number(m[1]));
  add('terms.rent_eur', /(\d{1,2}\.?\d{3}|\d{3,4})\s*(?:€|euros)\s*(?:\/\s*mes|al mes|mensuales)/i, (m) => num(m[1]));
  add('terms.deposit_months', /fianza\s*(?:de)?\s*:?\s*(\d)\s*mes(?:es)?/i, (m) => Number(m[1]));
  add('terms.extra_guarantee_months', /(?:garant[ií]a adicional|dep[oó]sito adicional|aval)\s*(?:de)?\s*:?\s*(\d)\s*mes(?:es)?/i, (m) => Number(m[1]));
  add('terms.agency_fee_to_tenant', /honorarios(?: de agencia)?[^.\n]{0,60}(?:inquilino|arrendatario|a cargo)|honorarios(?: de agencia)?\s*:?\s*\d/i, () => true);
  add('terms.agency_fee_eur', /honorarios[^.\n\d]{0,40}(\d{1,2}\.?\d{3}|\d{3,4})\s*€/i, (m) => num(m[1]));
  add('terms.rent_insurance_required', /seguro de impago[^.\n]{0,40}(?:obligatorio|imprescindible|requerido|necesario)|(?:obligatorio|imprescindible)[^.\n]{0,40}seguro de impago/i, () => true);
  add('terms.taxes_to_tenant', /IBI[^.\n]{0,40}(?:inquilino|arrendatario)/i, () => true);
  add('terms.rental_type', /\b(temporada|temporal)\b/i, () => 'temporada');
  return out;
}
