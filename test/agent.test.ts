import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// End to end on the saved copies of Catastro and the BOE (data/cache), no network,
// no model, no Zetaris: what a judge gets after cloning.
process.env.OFFLINE = '1';
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

test('a listing without the door makes the agent ask instead of guessing', async () => {
  const r = await run({ listing: read('argumosa-3.listing.txt') });
  assert.equal(r.findings.find((f) => f.checkId === 'area'), undefined);
  assert.equal(r.questions[0].options?.length, 7);
  const answered = await run({ listing: read('argumosa-3.listing.txt'), answers: { 'address.door': '3º C' } });
  assert.ok(answered.findings.find((f) => f.checkId === 'area'));
});
