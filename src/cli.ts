import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { run, type Report } from './agent.ts';
import { toMarkdown } from './render/markdown.ts';

// node src/cli.ts examples/argumosa-3c.listing.txt [--contract file] [--answer address.door=C] [--json out.json] [--markdown out.md]

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    contract: { type: 'string' },
    answer: { type: 'string', multiple: true },
    lat: { type: 'string' },
    lon: { type: 'string' },
    json: { type: 'string' },
    markdown: { type: 'string' },
  },
});

if (!positionals[0] && !values.contract) {
  console.error('usage: npm run check -- <listing.txt> [--contract file] [--answer attr=value] [--json out.json] [--markdown out.md]');
  process.exit(1);
}

const answers = Object.fromEntries((values.answer ?? []).map((a) => a.split('=', 2) as [string, string]));
const report = await run({
  listing: positionals[0] ? readFileSync(positionals[0], 'utf8') : undefined,
  contract: values.contract ? readFileSync(values.contract, 'utf8') : undefined,
  answers,
  lat: values.lat ? Number(values.lat) : undefined,
  lon: values.lon ? Number(values.lon) : undefined,
});

if (values.json) writeFileSync(values.json, JSON.stringify(report, null, 2));
if (values.markdown) writeFileSync(values.markdown, toMarkdown(report));
console.log(render(report));

function render(r: Report) {
  const dot = { red: '●', amber: '◐', unknown: '○', green: '·' };
  const src = new Map(r.sources.map((s) => [s.id, s]));
  const fact = new Map(r.facts.map((f) => [f.id, f]));
  const out = [`\nBEFORE YOU PAY THE DEPOSIT   ${r.summary.red} red · ${r.summary.amber} amber · ${r.summary.unknown} unknown · ${r.summary.green} ok\n`];
  for (const f of r.findings) {
    out.push(`${dot[f.status]} ${f.title.toUpperCase()}  [${f.status}]`);
    out.push(`  ${f.explanation}`);
    const cites = [...new Set(f.evidence.map((id) => fact.get(id)!.sourceId))].map((id) => src.get(id)!);
    out.push(`  sources: ${cites.map((s) => [s.label, s.version, s.live ? '' : 'cached'].filter(Boolean).join(' ')).join(' | ')}`);
    if (f.question) out.push(`  ask: ${f.question}`);
    out.push('');
  }
  for (const q of r.questions) out.push(`? ${q.text}${q.options ? `\n  options: ${q.options.join(', ')}` : ''}\n  answer with: --answer ${q.attribute}="…"\n`);
  for (const n of r.notes) out.push(`note (${n.agent}): ${n.text}`);
  out.push(`trace: logs/${r.runId}.jsonl (${r.trace.length} steps, provider ${r.provider})`);
  return out.join('\n');
}
