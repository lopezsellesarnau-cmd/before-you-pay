import type { WorldStore } from './store.ts';
import type { Finding } from './types.ts';

// ContextBuilder: the only way the LLM sees the world. It gets the facts behind one
// finding, each with its id and citation, and nothing else, so it cannot cite what
// is not there.
export function buildFindingContext(world: WorldStore, finding: Finding): string {
  const lines = finding.evidence.map((id) => {
    const f = world.fact(id);
    if (!f) return `[${id}] (missing)`;
    const s = world.sourceOf(f);
    const cite = [s.label, s.version, s.live ? null : 'cached copy'].filter(Boolean).join(', ');
    const quote = f.quote ? ` — "${f.quote}"` : '';
    return `[${f.id}] ${f.attribute} = ${f.value}${f.unit ? ' ' + f.unit : ''} (source: ${cite})${quote}`;
  });
  return [
    `CHECK: ${finding.title}`,
    `VERDICT: ${finding.status}`,
    `RULE OUTCOME: ${finding.detail}`,
    `FACTS:`,
    ...lines,
  ].join('\n');
}
