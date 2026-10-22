import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

process.env.OFFLINE = '1';
process.env.LLM_PROVIDER = 'sample';
delete process.env.ZETARIS_USER;
const { run } = await import('../src/agent.ts');
const { toMarkdown } = await import('../src/render/markdown.ts');
const listing = readFileSync(new URL('../examples/argumosa-3c.listing.txt', import.meta.url), 'utf8');

test('markdown report includes every finding title and a source link', async () => {
  const r = await run({ listing });
  const md = toMarkdown(r);
  for (const f of r.findings) assert.match(md, new RegExp(escape(f.title)));
  assert.match(md, /\[[^\]]+\]\(https?:\/\/[^)]+\)/);
});

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
