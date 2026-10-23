import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewExplanation, reviewExtraction } from '../src/agents/critic.ts';
import { CHECKS } from '../src/checks/index.ts';
import { WorldStore } from '../src/world/store.ts';

const listing = 'Precio: 1.450 €/mes. Fianza: 2 meses. Superficie: 72 m2 construidos.';

function world() {
  const w = new WorldStore();
  const src = w.addSource({ kind: 'listing', label: 'Listing', retrievedAt: '', live: true });
  return { w, src };
}

test('extraction: a quote that is not in the document is dropped', () => {
  const { w, src } = world();
  w.addFact({ attribute: 'terms.rent_eur', value: 1450, quote: 'Precio: 1.450 €/mes', sourceId: src.id, confidence: 'medium' });
  w.addFact({ attribute: 'unit.bedrooms', value: 3, quote: '3 dormitorios', sourceId: src.id, confidence: 'medium' });
  const r = reviewExtraction(w, src.id, listing);
  assert.equal(r.kept, 1);
  assert.match(r.dropped[0], /quote not in document/);
});

test('extraction: a value the quote does not contain is dropped', () => {
  const { w, src } = world();
  w.addFact({ attribute: 'unit.area_m2', value: 90, quote: '72 m2 construidos', sourceId: src.id, confidence: 'medium' });
  assert.match(reviewExtraction(w, src.id, listing).dropped[0], /value not in quote/);
});

test('explanation: invented numbers and foreign citations are rejected', () => {
  const { w, src } = world();
  const a = w.addFact({ attribute: 'terms.deposit_months', value: 2, quote: 'Fianza: 2 meses', sourceId: src.id, confidence: 'high' });
  const f = { checkId: 'deposit', status: 'red' as const, title: 'Fianza', detail: 'Asks for 2 months; the law sets 1 month.', evidence: [a.id] };
  assert.equal(reviewExplanation(w, f, `It asks for 2 months [${a.id}].`).ok, true);
  assert.equal(reviewExplanation(w, f, `It asks for 2 months, 600 € too much [${a.id}].`).ok, false);
  assert.equal(reviewExplanation(w, f, 'It asks for 2 months [f999].').ok, false);
  assert.equal(reviewExplanation(w, f, 'It asks for 2 months.').ok, false);
});

test('checks: without the law fact the deposit check is unknown, never a guess', () => {
  const { w, src } = world();
  w.addFact({ attribute: 'terms.deposit_months', value: 2, quote: 'Fianza: 2 meses', sourceId: src.id, confidence: 'high' });
  const f = CHECKS.find((c) => c.id === 'deposit')!.run(w)!;
  assert.equal(f.status, 'unknown');
});

test('checks: size inflated over 20% is red', () => {
  const { w, src } = world();
  const cat = w.addSource({ kind: 'catastro', label: 'Catastro', retrievedAt: '', live: true });
  w.addFact({ attribute: 'unit.area_m2', value: 72, sourceId: src.id, confidence: 'high' });
  w.addFact({ attribute: 'unit.area_m2', value: 56, sourceId: cat.id, confidence: 'high' });
  assert.equal(CHECKS.find((c) => c.id === 'area')!.run(w)!.status, 'red');
});

test('extraction: a quote about another field is dropped (no 0-month guarantee from the fianza line)', () => {
  const { w, src } = world();
  w.addFact({ attribute: 'terms.rent_eur', value: 1450, quote: 'Precio: 1.450 €/mes', sourceId: src.id, confidence: 'medium' });
  w.addFact({ attribute: 'terms.extra_guarantee_months', value: 0, quote: 'Fianza: 2 meses', sourceId: src.id, confidence: 'medium' });
  assert.match(reviewExtraction(w, src.id, listing).dropped[0], /about something else/);
});

test('extraction: a deposit given in euros converts to months', () => {
  const { w, src } = world();
  const text = 'Precio: 1.450 €/mes. Fianza de 2.900 €.';
  w.addFact({ attribute: 'terms.rent_eur', value: 1450, quote: 'Precio: 1.450 €/mes', sourceId: src.id, confidence: 'medium' });
  w.addFact({ attribute: 'terms.deposit_months', value: 2, quote: 'Fianza de 2.900 €', sourceId: src.id, confidence: 'medium' });
  assert.equal(reviewExtraction(w, src.id, text).dropped.length, 0);
});

test('explanation: 1,450 and 1.450 are the same number', () => {
  const { w, src } = world();
  const a = w.addFact({ attribute: 'terms.agency_fee_eur', value: 1450, quote: '1.450 €', sourceId: src.id, confidence: 'high' });
  const f = { checkId: 'agency_fees', status: 'red' as const, title: 'Fees', detail: 'Fees of 1450 €.', evidence: [a.id] };
  assert.equal(reviewExplanation(w, f, `Fees of 1,450 € [${a.id}].`).ok, true);
  assert.equal(reviewExplanation(w, f, `Fees of 1.450 € [${a.id}].`).ok, true);
});

test('risk guard: the template passes; threats, invented figures, commitments and personal data do not', async () => {
  const { reviewEmail } = await import('../src/agents/riskguard.ts');
  const { templateDraft } = await import('../src/agents/email.ts');
  const { w, src } = world();
  const law = w.addSource({ kind: 'boe', label: 'LAU art. 36', retrievedAt: '', live: true });
  const dep = w.addFact({ attribute: 'terms.deposit_months', value: 2, quote: 'Fianza: 2 meses', sourceId: src.id, confidence: 'medium' });
  const max = w.addFact({ attribute: 'law.max_deposit_months', value: 1, sourceId: law.id, confidence: 'high' });
  const f = { checkId: 'deposit', status: 'red' as const, title: 'Fianza', detail: 'Asks for 2 months of fianza; the law sets 1 month for housing.', evidence: [dep.id, max.id], question: 'Can you correct it?' };

  const t = templateDraft(w, [f]);
  assert.deepEqual(reviewEmail(w, [f], t), { ok: true });
  const bad = (body: string) => reviewEmail(w, [f], { subject: 'Piso', body: `Hola, la fianza [${dep.id}]. ${body}` });
  assert.match((bad('Esto es ilegal.') as any).reason, /accusatory/);
  assert.match((bad('Si no, lo denunciaré.') as any).reason, /legal action/);
  assert.match((bad('Pido 3 meses menos.') as any).reason, /numbers not in the evidence: 3/);
  assert.match((bad('Acepto el resto de condiciones.') as any).reason, /commits/);
  assert.match((bad('Llámame al 612 345 678.') as any).reason, /phone/);
  assert.match((reviewEmail(w, [f], { subject: 'Piso', body: 'Hola, ¿podemos hablar?' }) as any).reason, /leaves out red findings: deposit/);
});
