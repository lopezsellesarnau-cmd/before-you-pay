import type { Generate } from '../llm/provider.ts';
import { parseJson } from '../llm/provider.ts';
import { buildFindingContext } from '../world/context.ts';
import type { WorldStore } from '../world/store.ts';
import type { Fact, Finding, SourceKind, Value } from '../world/types.ts';

// Email agent (LLM). Turns the red and amber findings into a polite email to the landlord
// or agency, in Spanish, asking each question. It only drafts: nothing here sends mail.
// The Risk guard checks the draft and the renter approves it before sending it themselves.

export interface EmailDraft {
  subject: string;
  /** Text with the [fN] citations, as checked by the Risk guard. */
  cited: string;
  /** The same text without citations, ready to copy. */
  body: string;
  /** Findings the email covers. */
  covers: string[];
  status: 'draft';
  requiresApproval: true;
  /** "model" if the model's draft passed the guard, "template" if the fixed wording was used. */
  via: 'model' | 'template';
}

const SYSTEM = `You write, in Spanish, a short and polite email from a prospective tenant to the landlord or letting agency.
Return ONLY JSON: {"subject": "...", "body": "..."}.
- One short paragraph per POINT, keeping its meaning and its [fN] citations exactly as given.
- Use only the numbers in the points. Do not add any figure, date or deadline.
- Courteous and neutral: ask, do not accuse or threaten. No "ilegal", "estafa", "denuncia", "abogado", "exijo".
- Do not commit the tenant to anything (no "acepto", "firmaré", "pagaré").
- No names, phones, emails or ID numbers. Open with "Hola," and sign "[Tu nombre]".`;

/** Fixed Spanish wording per check, built only from the finding's evidence. */
export function point(world: WorldStore, f: Finding): string {
  const ev = (attr: string, kinds?: SourceKind[]): Fact | undefined =>
    f.evidence.map((id) => world.fact(id)!).find((x) => x.attribute === attr && (!kinds || kinds.includes(world.sourceOf(x).kind)));
  const n = (x?: Fact) => (x ? fmt(x.value) : undefined);
  const months = (x?: Fact) => `${n(x)} ${x?.value === 1 ? 'mes' : 'meses'}`;
  const cite = ' ' + f.evidence.map((id) => `[${id}]`).join(' ');
  const doc: SourceKind[] = ['listing', 'contract', 'renter'];
  const text = ((): string => {
    switch (f.checkId) {
      case 'area':
        return `El anuncio indica ${n(ev('unit.area_m2', doc))} m², pero el Catastro registra ${n(ev('unit.area_m2', ['catastro']))} m² para esta vivienda. ¿De dónde sale la diferencia y está legalizada?`;
      case 'use':
        return 'El Catastro no registra este inmueble con uso residencial. ¿Pueden confirmar que puede alquilarse como vivienda?';
      case 'deposit':
        return `Se piden ${months(ev('terms.deposit_months'))} de fianza, y la ley fija ${months(ev('law.max_deposit_months'))} para vivienda. ¿Pueden ajustarla?`;
      case 'extra_guarantee':
        return `Se pide una garantía adicional de ${months(ev('terms.extra_guarantee_months'))}. ¿Pueden ajustarla al máximo que permite la ley?`;
      case 'rent_insurance':
        return 'Se pide contratar un seguro de impago. La ley ya no permite exigírselo al inquilino; ¿pueden retirar ese requisito?';
      case 'agency_fees': {
        const fee = n(ev('terms.agency_fee_eur'));
        return `Se cobran al inquilino honorarios de agencia${fee ? ` de ${fee} €` : ''}. La ley establece que corren a cargo del propietario; ¿pueden confirmarlo?`;
      }
      case 'taxes':
        return 'Se repercute al inquilino el IBI u otros impuestos de la vivienda. La ley ya no lo permite; ¿pueden quitar esa condición?';
      case 'price':
        return 'La renta está por encima de lo que pagan tres de cada cuatro alquileres de la zona según el índice estatal de referencia (SERPAVI). ¿Habría margen para revisarla?';
      case 'consistency':
        return 'El anuncio y el contrato no coinciden en algunas condiciones. ¿Pueden confirmar cuáles son las definitivas?';
      default:
        return f.question ?? f.detail;
    }
  })();
  return text + cite;
}

export function templateDraft(world: WorldStore, findings: Finding[]): { subject: string; body: string } {
  const points = findings.map((f) => point(world, f));
  return {
    subject: 'Consultas sobre el piso antes de reservar',
    body: ['Hola,', 'Me interesa el piso y, antes de pagar ninguna reserva ni fianza, me gustaría aclarar algunos puntos:', ...points, 'Muchas gracias, quedo a la espera de su respuesta.', '[Tu nombre]'].join('\n\n'),
  };
}

/** Findings worth writing about: red and amber, with a question, and solid enough to put in writing. */
export function emailFindings(findings: Finding[]) {
  return findings.filter((f) => (f.status === 'red' || f.status === 'amber') && f.question && !f.needsReview);
}

export async function draftEmail(generate: Generate, world: WorldStore, findings: Finding[], feedback?: string) {
  const t = templateDraft(world, findings);
  const prompt = [
    ...findings.map((f) => buildFindingContext(world, f)),
    'POINTS:',
    ...findings.map((f) => `- ${point(world, f)}`),
    'DRAFT:',
    JSON.stringify(t),
    feedback ? `\nYour previous draft was rejected: ${feedback}. Fix that.` : '',
  ].join('\n');
  return parseJson<{ subject: string; body: string }>(await generate({ task: 'email', system: SYSTEM, prompt }));
}

export const stripCitations = (s: string) => s.replace(/\s*\[f\d+\]/g, '').replace(/[ \t]+\n/g, '\n').trim();

const fmt = (v: Value) => (typeof v === 'number' ? v.toLocaleString('es-ES') : String(v));
