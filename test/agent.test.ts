import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readDocument } from '../src/sources/document.ts';

// End to end on the saved copies of Catastro and the BOE (data/cache), no network,
// no model, no Zetaris: what a judge gets after cloning.
process.env.OFFLINE = '1';
process.env.CACHE_MAX_AGE_DAYS = '100000'; // the saved copies age; the tests should not
process.env.LLM_PROVIDER = 'sample';
delete process.env.ZETARIS_USER;
const { run } = await import('../src/agent.ts');
const read = (f: string) => readFileSync(new URL(`../examples/${f}`, import.meta.url), 'utf8');

test('the demo listing gets its red flags, each with sources', async () => {
  const r = await run({ listing: read('argumosa-3c.listing.txt') });
  const status = Object.fromEntries(r.findings.map((f) => [f.checkId, f.status]));
  assert.deepEqual(status, { area: 'red', deposit: 'red', rent_insurance: 'red', agency_fees: 'red', taxes: 'red', price: 'amber', use: 'green' });
  for (const f of r.findings) assert.ok(f.evidence.length > 0 && f.explanation);
});

test('a PDF contract is extracted and its additional guarantee is checked', async () => {
  const contract = await readDocument(fileURLToPath(new URL('../examples/contract-excessive-guarantee.pdf', import.meta.url)));
  assert.match(contract, /Garantía adicional: 4 meses/);

  const r = await run({ listing: read('argumosa-3c.listing.txt'), contract });
  const finding = r.findings.find((f) => f.checkId === 'extra_guarantee');
  assert.equal(finding?.status, 'red');
  assert.ok(finding?.evidence.length);
});

test('a PDF contract with a different rent is flagged against the listing', async () => {
  const contract = await readDocument(fileURLToPath(new URL('../examples/contract-contradicts-listing.pdf', import.meta.url)));
  const r = await run({ listing: read('argumosa-3c.listing.txt'), contract });
  const finding = r.findings.find((f) => f.checkId === 'consistency');
  assert.equal(finding?.status, 'amber');
  const rents = r.facts.filter((f) => finding.evidence.includes(f.id) && f.attribute === 'terms.rent_eur').map((f) => f.value);
  assert.deepEqual(rents.sort(), [1450, 1650]);
  // The price check uses the rent in the contract, not the advertised one.
  assert.match(r.findings.find((f) => f.checkId === 'price')?.detail ?? '', /^1650 €/);
});

test('a listing without the door makes the agent ask instead of guessing', async () => {
  const r = await run({ listing: read('argumosa-3.listing.txt') });
  assert.equal(r.findings.find((f) => f.checkId === 'area'), undefined);
  assert.equal(r.questions[0].options?.length, 7);
  const answered = await run({ listing: read('argumosa-3.listing.txt'), answers: { 'address.door': '3º C' } });
  assert.ok(answered.findings.find((f) => f.checkId === 'area'));
});

test('the report carries an email draft that waits for the renter', async () => {
  const r = await run({ listing: read('argumosa-3c.listing.txt') });
  assert.equal(r.email?.requiresApproval, true);
  assert.deepEqual(r.email?.covers.sort(), ['agency_fees', 'area', 'deposit', 'price', 'rent_insurance', 'taxes']);
  assert.doesNotMatch(r.email!.body, /\[f\d+\]/);
  assert.match(r.email!.body, /1450 €/);
});

test('a finding built on a figure the listing and contract disagree on goes to human review', async () => {
  const contract = await readDocument(fileURLToPath(new URL('../examples/contract-contradicts-listing.pdf', import.meta.url)));
  const r = await run({ listing: read('argumosa-3c.listing.txt'), contract });
  const price = r.findings.find((f) => f.checkId === 'price')!;
  assert.equal(price.confidence, 'low');
  assert.equal(price.needsReview, true);
  assert.match(price.caveats!.join(' '), /listing says 1450 and the contract 1650/);
  assert.equal(r.summary.needsReview, r.findings.filter((f) => f.needsReview).length);
  assert.ok(!r.email?.covers.includes('price'));
});

test('saved copies lower confidence; old ones send the finding to review', async () => {
  const r = await run({ listing: read('argumosa-3c.listing.txt') });
  const area = r.findings.find((f) => f.checkId === 'area')!;
  assert.equal(area.confidence, 'medium');
  assert.ok(!area.needsReview);
  process.env.CACHE_MAX_AGE_DAYS = '-1';
  try {
    const old = await run({ listing: read('argumosa-3c.listing.txt') });
    assert.ok(old.findings.find((f) => f.checkId === 'area')!.needsReview);
  } finally {
    process.env.CACHE_MAX_AGE_DAYS = '100000';
  }
});

test('a scam listing is flagged red with each signal cited', async () => {
  const r = await run({ listing: read('argumosa-3c.scam.listing.txt') });
  const scam = r.findings.find((f) => f.checkId === 'scam')!;
  assert.equal(scam.status, 'red');
  for (const s of [/before visiting/, /cannot be visited/, /western union/, /abroad/, /9.82 €\/m²/]) assert.match(scam.detail, s);
  const attrs = r.facts.filter((f) => scam.evidence.includes(f.id)).map((f) => f.attribute);
  for (const a of ['terms.pay_before_visit', 'terms.no_visit', 'terms.payment_method', 'landlord.abroad', 'ref.eur_m2_p25']) assert.ok(attrs.includes(a), a);
  assert.deepEqual(r.email?.covers, ['scam']);
});
