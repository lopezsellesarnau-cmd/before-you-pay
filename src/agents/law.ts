import { lauArticle, sentence, type Article } from '../sources/boe.ts';
import type { WorldStore } from '../world/store.ts';

// Law specialist (code). Each rule is bound to a sentence that must exist, word for
// word, in the version of the LAU in force today. If the BOE text changes (RDL 29/2026
// still needs Congress to validate it), the sentence is not found, the rule is not
// asserted, and the check reports "unknown" instead of applying stale law.

interface Rule {
  attribute: string;
  value: number | boolean;
  article: number;
  needle: string;
}

export const RULES: Rule[] = [
  { attribute: 'law.max_deposit_months', value: 1, article: 36, needle: 'equivalente a una mensualidad de renta en el arrendamiento de viviendas' },
  { attribute: 'law.max_extra_guarantee_months', value: 2, article: 36, needle: 'garantía adicional no podrá exceder de dos mensualidades' },
  { attribute: 'law.max_extra_guarantee_months_temporada', value: 1, article: 36, needle: 'arrendamientos temporales el valor de esta garantía no podrá exceder de una mensualidad' },
  { attribute: 'law.rent_insurance_forbidden', value: true, article: 36, needle: 'En ningún caso podrá exigirse al arrendatario la contratación de seguros de impago' },
  { attribute: 'law.agency_fees_forbidden', value: true, article: 20, needle: 'no podrán ser repercutidos al arrendatario' },
  { attribute: 'law.taxes_to_tenant_forbidden', value: true, article: 20, needle: 'En ningún caso podrán imponerse los tributos asociados a la vivienda a la parte arrendataria' },
];

export async function fetchLaw(world: WorldStore, attributes: string[]) {
  const rules = RULES.filter((r) => attributes.includes(r.attribute));
  const articles = new Map<number, Article>();
  for (const n of new Set(rules.map((r) => r.article))) articles.set(n, await lauArticle(n));

  const missing: string[] = [];
  for (const rule of rules) {
    const a = articles.get(rule.article)!;
    const quote = sentence(a, rule.needle);
    if (!quote) {
      missing.push(rule.attribute);
      continue;
    }
    const src =
      [...world.sources.values()].find((s) => s.url === a.humanUrl) ??
      world.addSource({
        kind: 'boe',
        label: `LAU art. ${rule.article}`,
        url: a.humanUrl,
        version: `in force since ${a.inForceSince} (${a.amendedBy})`,
        retrievedAt: a.retrievedAt,
        live: a.live,
      });
    world.addFact({ attribute: rule.attribute, value: rule.value, sourceId: src.id, quote, confidence: a.live ? 'high' : 'medium' });
  }
  return { missing };
}
