import type { Generate } from '../llm/provider.ts';
import { parseJson } from '../llm/provider.ts';
import type { WorldStore } from '../world/store.ts';
import type { Source, Value } from '../world/types.ts';

// Extractor (LLM): listing or contract text → fields, each with the verbatim quote
// that supports it. It does not judge anything; the checks do.

export const FIELDS: Record<string, string> = {
  'address.street_type': 'street type code as Catastro uses it: CL (calle), AV (avenida), PZ (plaza), PS (paseo), CR (carretera), RD (ronda), TR (travesía)',
  'address.street': 'street name without the type, e.g. "ARGUMOSA"',
  'address.number': 'building number',
  'address.floor': 'floor as a number ("3" for 3º, "0" for bajo)',
  'address.door': 'door letter or number, e.g. "C", "IZQ"',
  'address.municipality': 'municipality',
  'address.province': 'province',
  'unit.catastro_ref': 'Catastro reference if written (20 chars)',
  'unit.area_m2': 'surface in m² as advertised (number)',
  'unit.area_kind': '"construidos" or "utiles" if stated',
  'unit.bedrooms': 'number of bedrooms',
  'terms.rent_eur': 'monthly rent in EUR (number)',
  'terms.deposit_months': 'fianza in months of rent (number); if given in EUR, convert using the rent and quote both',
  'terms.extra_guarantee_months': 'additional guarantee (garantía adicional, aval, depósito) in months of rent (number)',
  'terms.agency_fee_to_tenant': 'true if the tenant is asked to pay agency/management/contract fees (honorarios, gastos de gestión)',
  'terms.agency_fee_eur': 'amount of those fees in EUR if stated (number)',
  'terms.rent_insurance_required': 'true if the tenant must take out rent default insurance (seguro de impago)',
  'terms.taxes_to_tenant': 'true if IBI or other property taxes are charged to the tenant',
  'terms.rental_type': '"habitual" or "temporada"',
  'terms.pay_before_visit': 'true if money (reserva, señal, fianza) is asked for before visiting the flat or signing',
  'terms.payment_method': 'how payment is asked for: "western_union", "moneygram", "crypto", "gift_card", "transfer_abroad", "cash", "bizum" or "bank_transfer"',
  'terms.no_visit': 'true if the flat cannot be visited, or the keys are sent by post or courier',
  'landlord.abroad': 'true if the landlord says they live abroad or cannot meet in person',
};

export interface Extracted {
  attribute: string;
  value: Value;
  quote: string;
}

const SYSTEM = `You extract facts from Spanish rental listings and contracts.
Return ONLY a JSON array of {"attribute","value","quote"}.
- "quote" must be copied character for character from the document and contain both the value and the words that say what it is ("Honorarios de agencia: 1.450 €", not "1.450 €").
- Only include a field if the document states it. Never infer, never guess.
- Numbers as JSON numbers (1450, not "1.450 €"). Booleans as true/false.`;

export async function extract(generate: Generate, kind: Source['kind'], text: string): Promise<Extracted[]> {
  const fields = Object.entries(FIELDS)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  const prompt = `Document type: ${kind}\n\nFields:\n${fields}\n\nDocument:\n"""\n${text}\n"""`;
  // Models sometimes return broken JSON; say what was wrong and ask again.
  let error = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const out = await generate({ task: 'extract', system: SYSTEM, prompt: prompt + error });
    try {
      const items = parseJson<Extracted[]>(out);
      if (!Array.isArray(items)) throw new Error('not an array');
      return items.filter((e) => e && e.attribute in FIELDS);
    } catch (e) {
      error = `\n\nYour previous answer was not valid JSON (${(e as Error).message}). Return only the JSON array.`;
    }
  }
  throw new Error(`extractor: no valid JSON after 3 attempts${error}`);
}

/** Store the extraction. Validation of each quote is the critic's job. */
export function ingestExtraction(world: WorldStore, sourceId: string, items: Extracted[]) {
  for (const e of items) {
    world.addFact({ attribute: e.attribute, value: e.value, sourceId, quote: e.quote, confidence: 'medium' });
  }
}
