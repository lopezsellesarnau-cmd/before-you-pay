import type { Generate } from '../llm/provider.ts';
import { buildFindingContext } from '../world/context.ts';
import type { WorldStore } from '../world/store.ts';
import type { Finding } from '../world/types.ts';

// Explainer (LLM). Turns one finding into two plain sentences for the renter, using
// only the facts the ContextBuilder hands it. The critic checks the result.

const SYSTEM = `You explain one check of a rental listing to a renter in Spain.
Write at most two short sentences in plain ${process.env.REPORT_LANG === 'es' ? 'Spanish' : 'English'}.
Use only the FACTS given. Cite every fact you use by its id in brackets, like [f3].
Do not introduce any number that is not in the facts or the rule outcome.
Percentiles are not minimums or maximums: p25 means a quarter of leases pay less, p75 that three in four do.
Do not give legal advice and do not tell them to sign or not sign; say what the records or the law show.`;

export async function explain(generate: Generate, world: WorldStore, f: Finding, feedback?: string): Promise<string> {
  const prompt = buildFindingContext(world, f) + (feedback ? `\n\nYour previous answer was rejected: ${feedback}. Fix that.` : '');
  return (await generate({ task: 'explain', system: SYSTEM, prompt })).trim();
}
