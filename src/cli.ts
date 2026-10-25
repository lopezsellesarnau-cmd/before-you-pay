import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { run, type Report } from './agent.ts';
import { toMarkdown } from './render/markdown.ts';
import { readDocument } from './sources/document.ts';
// node src/cli.ts examples/argumosa-3c.listing.txt [--contract file] [--answer address.door=C] [--photo url] [--json out.json] [--markdown out.md]

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    contract: { type: 'string' },
    answer: { type: 'string', multiple: true },
    lat: { type: 'string' },
    lon: { type: 'string' },
    photo: { type: 'string', multiple: true },
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
  listing: positionals[0] ? await readDocument(positionals[0]) : undefined,
  contract: values.contract ? await readDocument(values.contract) : undefined,
  answers,
  lat: values.lat ? Number(values.lat) : undefined,
  lon: values.lon ? Number(values.lon) : undefined,
  photos: values.photo,
});

if (values.json) writeFileSync(values.json, JSON.stringify(report, null, 2));
if (values.markdown) writeFileSync(values.markdown, toMarkdown(report));
console.log(render(report));

function render(r: Report) {
  const dot = { red: '●', amber: '◐', unknown: '○', green: '·' };
  const src = new Map(r.sources.map((s) => [s.id, s]));
  const fact = new Map(r.facts.map((f) => [f.id, f]));
  const out = [`\nBEFORE YOU PAY THE DEPOSIT   ${r.summary.red} red · ${r.summary.amber} amber · ${r.summary.unknown} unknown · ${r.summary.green} ok${r.summary.needsReview ? ` · ${r.summary.needsReview} to check yourself` : ''}\n`];
  for (const f of r.findings) {
    out.push(`${dot[f.status]} ${f.title.toUpperCase()}  [${f.status}]`);
    out.push(`  ${f.explanation}`);
    const cites = [...new Set(f.evidence.map((id) => fact.get(id)!.sourceId))].map((id) => src.get(id)!);
    out.push(`  sources: ${cites.map((s) => [s.label, s.version, s.live ? '' : 'cached'].filter(Boolean).join(' ')).join(' | ')}`);
    if (f.question) out.push(`  ask: ${f.question}`);
    if (f.needsReview) out.push(`  ⚠ CHECK THIS YOURSELF before relying on it (left out of the email)`);
    for (const c of f.caveats ?? []) out.push(`  caveat: ${c}`);
    out.push('');
  }
  for (const q of r.questions) out.push(`? ${q.text}${q.options ? `\n  options: ${q.options.join(', ')}` : ''}\n  answer with: --answer ${q.attribute}="…"\n`);
  for (const n of r.notes) out.push(`note (${n.agent}): ${n.text}`);
  if (r.email) out.push(`\nEMAIL DRAFT — not sent; review it and send it yourself\nSubject: ${r.email.subject}\n\n${r.email.body}\n`);
  out.push(`trace: logs/${r.runId}.jsonl (${r.trace.length} steps, provider ${r.provider})`);
  return out.join('\n');
}
