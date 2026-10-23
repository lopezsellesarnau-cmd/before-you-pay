import type { Report } from '../agent.ts';

export function toMarkdown(r: Report): string {
  const src = new Map(r.sources.map((s) => [s.id, s]));
  const fact = new Map(r.facts.map((f) => [f.id, f]));
  const out = [
    '# Before you pay the deposit',
    '',
    `${r.summary.red} red · ${r.summary.amber} amber · ${r.summary.unknown} unknown · ${r.summary.green} ok${r.summary.needsReview ? ` · ${r.summary.needsReview} to check yourself` : ''}`,
    '',
  ];
  for (const f of r.findings) {
    out.push(`## ${f.title} [${f.status}]`, '', f.explanation ?? f.detail, '');
    const cites = [...new Set(f.evidence.map((id) => fact.get(id)!.sourceId))].map((id) => src.get(id)!);
    out.push(`**Sources:** ${cites.map(cite).join(' | ')}`, '');
    if (f.question) out.push(`Ask: ${f.question}`, '');
    if (f.needsReview) out.push('**Check this yourself before relying on it.** Left out of the email.', '');
    if (f.caveats?.length) out.push(...f.caveats.map((c) => `- ${c}`), '');
  }
  if (r.questions.length) {
    out.push('## Open questions', '');
    for (const q of r.questions) {
      out.push(q.text);
      if (q.options?.length) out.push(`Options: ${q.options.join(', ')}`);
      out.push('');
    }
  }
  if (r.notes.length) {
    out.push('## Notes', '');
    for (const n of r.notes) out.push(`- (${n.agent}): ${n.text}`);
    out.push('');
  }
  if (r.email) {
    out.push('## Email draft (not sent)', '', 'Checked by the Risk guard. Review it and send it yourself.', '', `**Subject:** ${r.email.subject}`, '');
    out.push(...r.email.body.split('\n').map((l) => (l ? `> ${l}` : '>')), '');
  }
  out.push(`Trace: logs/${r.runId}.jsonl (${r.trace.length} steps)`);
  return out.join('\n');
}

function cite(s: { label: string; url?: string; version?: string; live: boolean }) {
  const label = s.url ? `[${s.label}](${s.url})` : s.label;
  return [label, s.version, s.live ? '' : 'cached'].filter(Boolean).join(' ');
}
