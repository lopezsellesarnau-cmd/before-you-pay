import type { WorldStore } from '../world/store.ts';
import type { Finding } from '../world/types.ts';
import { inventedNumbers, type Verdict } from './critic.ts';

// Risk guard (code). The last check before the renter sees the email: it has to be
// grounded, polite, and must not commit them to anything or leak personal data.
// A draft that fails goes back to the model with the reason, then falls back to the template.

const RULES: [RegExp, string][] = [
  [/ilegal|estafa|fraud|timo|abus(o|ivo)|delito|sinvergüenza|vergüenza/i, 'accusatory wording'],
  [/denunci|demand(ar|aré|a judicial)|abogad|juzgad|tribunal|polic[ií]a|consumo|reclamaci[oó]n oficial/i, 'threatens legal action'],
  [/exij|le advierto|de lo contrario|o tendr[ée]|plazo de \w+ d[ií]as|inmediatamente/i, 'demanding or ultimatum tone'],
  [/es nul[oa]|le aseguro|garantizo|sin ninguna duda/i, 'states a legal conclusion as certain'],
  [/\bacepto\b|firmar[ée]|pagar[ée]|transferir[ée]|me comprometo|reservo ya/i, 'commits the renter'],
  [/[\w.+-]+@[\w-]+\.\w+/, 'contains an email address'],
  [/(?<!\d)(\+34\s?)?[6789]\d{2}[\s.]?\d{3}[\s.]?\d{3}(?!\d)/, 'contains a phone number'],
  [/\b\d{8}[A-HJ-NP-TV-Z]\b|\b[XYZ]\d{7}[A-Z]\b/, 'contains an ID number'],
  [/\bES\d{2}[\s\d]{20,}/, 'contains a bank account'],
  [/!!|[A-ZÁÉÍÓÚÑ]{6,}(?:\s+[A-ZÁÉÍÓÚÑ]{2,}){2,}/, 'shouting'],
];

export function reviewEmail(world: WorldStore, findings: Finding[], draft: { subject?: string; body?: string }): Verdict {
  if (!draft?.subject?.trim() || !draft?.body?.trim()) return { ok: false, action: 'retry', reason: 'missing subject or body' };
  const text = `${draft.subject}\n${draft.body}`;
  if (draft.body.length > 2500) return { ok: false, action: 'retry', reason: 'too long' };

  const cited = new Set([...text.matchAll(/\[(f\d+)\]/g)].map((m) => m[1]));
  const evidence = new Set(findings.flatMap((f) => f.evidence));
  const foreign = [...cited].filter((id) => !evidence.has(id));
  if (foreign.length) return { ok: false, action: 'retry', reason: `cites facts outside the findings: ${foreign.join(', ')}` };
  const missed = findings.filter((f) => f.status === 'red' && !f.evidence.some((id) => cited.has(id)));
  if (missed.length) return { ok: false, action: 'retry', reason: `leaves out red findings: ${missed.map((f) => f.checkId).join(', ')}` };

  for (const [re, why] of RULES) {
    const m = text.match(re);
    if (m) return { ok: false, action: 'retry', reason: `${why}: "${m[0]}"` };
  }

  const invented = inventedNumbers(world, findings, text);
  if (invented.length) return { ok: false, action: 'retry', reason: `numbers not in the evidence: ${invented.join(', ')}` };
  return { ok: true };
}
