import type { CatastroResult, CatastroUnit } from '../sources/catastro.ts';
import type { WorldStore } from '../world/store.ts';
import type { Confidence, Finding } from '../world/types.ts';

// Critic (code). Sits after every step and decides whether its output can be trusted,
// has to be retried another way, or needs the renter. It is what turns a pipeline into
// something that recovers: the planner reads its verdicts to choose the next step.

export type Verdict =
  | { ok: true }
  | { ok: false; action: 'retry' | 'ask' | 'give_up'; reason: string };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// A quote must be about the field it supports, not just contain a matching number:
// "Fianza: 2 meses" cannot back an additional guarantee.
const TOPIC: Record<string, RegExp> = {
  'terms.deposit_months': /fianza/i,
  'terms.extra_guarantee_months': /garant[ií]a|aval|dep[oó]sito/i,
  'terms.agency_fee_to_tenant': /honorario|agencia|gesti[oó]n|comisi[oó]n|inmobiliaria/i,
  'terms.agency_fee_eur': /honorario|agencia|gesti[oó]n|comisi[oó]n|inmobiliaria/i,
  'terms.rent_insurance_required': /seguro|impago/i,
  'terms.taxes_to_tenant': /ibi|impuesto|tributo|tasa/i,
  'terms.rent_eur': /€|eur|precio|renta|alquiler|mes/i,
  'unit.area_m2': /m2|m²|metros/i,
  'terms.pay_before_visit': /pag|transfer|reserv|señal|ingres/i,
  'terms.payment_method': /western|moneygram|cripto|bitcoin|tarjeta|transferencia|bizum|efectivo|pago/i,
  'terms.no_visit': /visit|llave|enseñ/i,
  'landlord.abroad': /extranjero|fuera de|vivo|resido|trabajo en/i,
};

/** Every extracted value must be backed by a verbatim quote that contains it. */
export function reviewExtraction(world: WorldStore, sourceId: string, text: string): { kept: number; dropped: string[] } {
  const doc = norm(text);
  const dropped: string[] = [];
  const facts = world.facts.filter((f) => f.sourceId === sourceId);
  for (const f of facts) {
    const why = !f.quote
      ? 'no quote'
      : !doc.includes(norm(f.quote))
        ? 'quote not in document'
        : TOPIC[f.attribute] && !TOPIC[f.attribute].test(f.quote)
          ? 'quote is about something else'
          : typeof f.value === 'number' && !numberIn(f.quote, f.value, world.value<number>('terms.rent_eur', ['listing', 'contract']))
          ? 'value not in quote'
          : undefined;
    if (why) {
      world.removeFact(f.id);
      dropped.push(`${f.attribute} (${why})`);
    } else {
      f.confidence = 'high';
    }
  }
  // Same document, same attribute, two values: keep neither, ask.
  const left = world.facts.filter((f) => f.sourceId === sourceId);
  for (const attr of new Set(left.map((f) => f.attribute))) {
    const vals = new Set(left.filter((f) => f.attribute === attr).map((f) => String(f.value)));
    if (vals.size > 1) {
      left.filter((f) => f.attribute === attr).forEach((f) => world.removeFact(f.id));
      dropped.push(`${attr} (contradicts itself: ${[...vals].join(' / ')})`);
      world.ask({ attribute: attr, text: `The document gives several values for ${attr}: ${[...vals].join(', ')}. Which one is right?`, options: [...vals], reason: 'contradiction in the document' });
    }
  }
  return { kept: world.facts.filter((f) => f.sourceId === sourceId).length, dropped };
}

/** 1450 matches "1.450", "1450", "1 450"; month counts may be given in euros (2.900 € = 2 months). */
function numberIn(quote: string, value: number, rent?: number): boolean {
  const digits = quote.replace(/(\d)[.\s](?=\d{3}\b)/g, '$1').replace(',', '.');
  const nums = [...digits.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  const words: Record<number, string> = { 1: 'un', 2: 'dos', 3: 'tres', 4: 'cuatro', 5: 'cinco', 6: 'seis' };
  if (nums.includes(value)) return true;
  if (words[value] && new RegExp(`\\b${words[value]}[ao]?\\b`, 'i').test(quote)) return true;
  // Only figures that look like euros (at least half a month of rent) count as a conversion.
  return !!rent && value > 0 && nums.some((n) => n >= rent / 2 && Math.abs(n / rent - value) < 0.01);
}

export function reviewCatastro(world: WorldStore, r: CatastroResult | undefined, matches: CatastroUnit[]): Verdict {
  if (!r) return { ok: false, action: 'retry', reason: 'not enough data for this lookup strategy' };
  if (r.error || r.units.length === 0) return { ok: false, action: 'retry', reason: r.error ?? 'no units found' };
  if (!r.live) world.note('critic', `Catastro was unreachable; using the copy saved on ${r.retrievedAt.slice(0, 10)}.`);

  if (matches.length === 1) return { ok: true };

  const dwellings = r.units.filter((u) => u.use === 'Residencial');
  const floor = world.value('address.floor');
  if (matches.length === 0) {
    world.ask({
      attribute: 'address.door',
      text: `Catastro has no unit at floor ${floor ?? '?'} door ${world.value('address.door') ?? '?'} in this building. Which one is it?`,
      options: dwellings.map((u) => `${u.floor}º ${u.door}`),
      reason: 'floor/door not on record',
    });
    return { ok: false, action: 'ask', reason: 'floor/door not on record' };
  }
  world.ask({
    attribute: floor == null ? 'address.floor' : 'address.door',
    text: `This building has ${dwellings.length} registered dwellings${floor != null ? ` and ${matches.length} on floor ${floor}` : ''}. Which floor and door is the flat?`,
    options: matches.map((u) => `${u.floor}º ${u.door}`),
    reason: `${matches.length} candidate units`,
  });
  return { ok: false, action: 'ask', reason: `${matches.length} candidate units, listing does not say which` };
}

/** Findings must rest on facts that exist; cached evidence is flagged. */
export function reviewFinding(world: WorldStore, f: Finding): Verdict {
  if (f.evidence.length === 0) return { ok: false, action: 'give_up', reason: 'no evidence' };
  const missing = f.evidence.filter((id) => !world.fact(id));
  if (missing.length) return { ok: false, action: 'give_up', reason: `evidence missing: ${missing.join(', ')}` };
  return { ok: true };
}

/**
 * The explanation may only cite evidence ids and may only use numbers that appear in
 * the evidence or the rule outcome. Otherwise it is discarded and the rule outcome
 * is shown instead.
 */
export function reviewExplanation(world: WorldStore, f: Finding, text: string): Verdict {
  const cited = [...text.matchAll(/\[(f\d+)\]/g)].map((m) => m[1]);
  if (cited.length === 0) return { ok: false, action: 'retry', reason: 'cites no evidence' };
  const foreign = cited.filter((id) => !f.evidence.includes(id));
  if (foreign.length) return { ok: false, action: 'retry', reason: `cites facts outside the evidence: ${foreign.join(', ')}` };

  const invented = inventedNumbers(world, [f], text);
  if (invented.length) return { ok: false, action: 'retry', reason: `numbers not in the evidence: ${invented.join(', ')}` };
  return { ok: true };
}

/** Numbers in `text` that none of the findings (rule outcome, question, evidence) contains. */
export function inventedNumbers(world: WorldStore, findings: Finding[], text: string): string[] {
  const allowed = new Set<string>();
  const harvest = (s: string) => [...s.replace(/(\d)[.,](?=\d{3}\b)/g, '$1').matchAll(/\d+(?:[.,]\d+)?/g)].forEach((m) => allowed.add(m[0].replace(',', '.')));
  for (const f of findings) {
    harvest(f.detail);
    harvest(f.question ?? '');
    for (const id of f.evidence) {
      const fact = world.fact(id)!;
      harvest(String(fact.value));
      harvest(fact.attribute); // "p75" makes "75th percentile" legitimate
      harvest(fact.quote ?? '');
      harvest(world.sourceOf(fact).label);
      harvest(world.sourceOf(fact).version ?? '');
    }
  }
  const body = text.replace(/\[f\d+\]/g, '').replace(/(\d)[.,](?=\d{3}\b)/g, '$1');
  return [...body.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(',', '.')).filter((n) => !allowed.has(n));
}

const RANK = { high: 2, medium: 1, low: 0 } as const;
const DAY = 86_400_000;

/**
 * How far the renter can lean on a finding, from its evidence. Low means a person has to
 * look before relying on it: it is flagged in the report and kept out of the email.
 */
export function assessConfidence(world: WorldStore, f: Finding, now = Date.now()): { confidence: Confidence; reasons: string[] } {
  let confidence: Confidence = 'high';
  const reasons: string[] = [];
  const lower = (to: Confidence, why: string) => {
    if (RANK[to] < RANK[confidence]) confidence = to;
    if (!reasons.includes(why)) reasons.push(why);
  };
  const facts = f.evidence.map((id) => world.fact(id)!);

  for (const fact of facts) {
    const s = world.sourceOf(fact);
    if (!s.live && ['catastro', 'boe', 'serpavi'].includes(s.kind)) {
      const age = Math.floor((now - Date.parse(s.retrievedAt)) / DAY);
      if (age > Number(process.env.CACHE_MAX_AGE_DAYS ?? 30)) lower('low', `${s.label} comes from a copy saved ${age} days ago; it may have changed.`);
      else lower('medium', `${s.label} comes from a saved copy, not a live answer.`);
    }
    if (fact.confidence === 'low' && fact.attribute.startsWith('ref.')) {
      lower('low', `The SERPAVI figure rests on only ${world.value('ref.sample_n')} leases.`);
    }
  }

  // The finding stands on a figure the listing and the contract disagree on.
  if (f.checkId !== 'consistency') {
    const fromDocs = facts.filter((x) => ['listing', 'contract'].includes(world.sourceOf(x).kind));
    for (const attr of new Set(fromDocs.map((x) => x.attribute))) {
      const l = world.get(attr, ['listing']);
      const c = world.get(attr, ['contract']);
      if (l && c && l.value !== c.value && !world.has(attr, ['renter'])) lower('low', `The listing says ${l.value} and the contract ${c.value} for ${attr}; this uses the contract.`);
    }
  }

  if (f.checkId === 'price') {
    if (!facts.some((x) => x.attribute === 'unit.area_m2' && world.sourceOf(x).kind === 'catastro')) lower('medium', 'Price per m² uses the advertised size; Catastro did not confirm it.');
    if (world.value('ref.level') === 'municipio' && world.has('unit.district', ['catastro'])) lower('medium', 'No SERPAVI figure for the district; compared with the whole municipality.');
  }
  return { confidence, reasons };
}
