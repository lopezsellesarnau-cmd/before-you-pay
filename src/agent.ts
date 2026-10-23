import { randomUUID } from 'node:crypto';
import * as catastro from './agents/catastro.ts';
import { assessConfidence, reviewCatastro, reviewExplanation, reviewExtraction, reviewFinding } from './agents/critic.ts';
import { draftEmail, emailFindings, stripCitations, templateDraft, type EmailDraft } from './agents/email.ts';
import { explain } from './agents/explainer.ts';
import { extract, ingestExtraction } from './agents/extractor.ts';
import { fetchLaw } from './agents/law.ts';
import { lookupReference } from './agents/price.ts';
import { reviewEmail } from './agents/riskguard.ts';
import { CHECKS } from './checks/index.ts';
import { provider, type Generate } from './llm/provider.ts';
import { Trace } from './log.ts';
import { WorldStore } from './world/store.ts';
import type { Finding, Source } from './world/types.ts';

export interface Input {
  listing?: string;
  contract?: string;
  /** Answers to earlier questions, by attribute. "3º C" is accepted for floor/door. */
  answers?: Record<string, string>;
  lat?: number;
  lon?: number;
}

type Task =
  | { kind: 'extract'; doc: 'listing' | 'contract' }
  | { kind: 'catastro'; strategy: catastro.Strategy }
  | { kind: 'law'; attributes: string[] }
  | { kind: 'price' }
  | { kind: 'check' };

const STRATEGIES: catastro.Strategy[] = ['reference', 'address', 'address-normalised', 'coordinates'];
const ORDER = { red: 0, amber: 1, unknown: 2, green: 3 };

export async function run(input: Input) {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`;
  const trace = new Trace(runId);
  const world = new WorldStore();
  const llm = await provider();
  trace.log('planner', 'start', { provider: llm.name, model: llm.model });

  const docSources = new Map<string, Source>();
  for (const doc of ['listing', 'contract'] as const) {
    if (input[doc]) docSources.set(doc, world.addSource({ kind: doc, label: doc === 'listing' ? 'Listing' : 'Contract', retrievedAt: new Date().toISOString(), live: true }));
  }
  ingestAnswers(world, input);

  let email: EmailDraft | undefined;
  const state = { extracted: new Set<string>(), tried: new Set<catastro.Strategy>(), catastroSettled: false, lawTried: new Set<string>(), priceTried: false };

  // Planner: look at the world, pick what is still worth doing. Ends when nothing is.
  const plan = (): Task | undefined => {
    for (const doc of docSources.keys()) if (!state.extracted.has(doc)) return { kind: 'extract', doc: doc as 'listing' | 'contract' };
    if (!state.catastroSettled) {
      const next = STRATEGIES.find((s) => !state.tried.has(s) && feasible(world, s));
      if (next) return { kind: 'catastro', strategy: next };
      state.catastroSettled = true;
      trace.log('planner', 'catastro: no strategy left', { tried: [...state.tried] });
      if (!world.has('unit.area_m2', ['catastro'])) world.note('planner', 'Could not identify the flat in Catastro; size and use checks skipped.');
    }
    const needed = CHECKS.filter((c) => c.law.length && c.run(world))
      .flatMap((c) => c.law)
      .filter((a) => !world.has(a) && !state.lawTried.has(a));
    if (needed.length) return { kind: 'law', attributes: [...new Set(needed)] };
    if (!state.priceTried && world.has('unit.ine_municipality', ['catastro']) && world.has('terms.rent_eur')) return { kind: 'price' };
    return { kind: 'check' };
  };

  for (let i = 0; i < 12; i++) {
    const task = plan()!;
    trace.log('planner', `next: ${task.kind}`, task);

    if (task.kind === 'extract') {
      state.extracted.add(task.doc);
      const src = docSources.get(task.doc)!;
      let items: Awaited<ReturnType<typeof extract>> = [];
      try {
        items = await extract(llm.generate, task.doc, input[task.doc]!);
      } catch (e) {
        trace.log('extractor', `${task.doc}: failed`, String(e));
        world.note('extractor', `Could not read the ${task.doc}; its checks are missing. Try again.`);
      }
      ingestExtraction(world, src.id, items);
      trace.log('extractor', `${items.length} fields from ${task.doc}`, items);
      const r = reviewExtraction(world, src.id, input[task.doc]!);
      trace.log('critic', `extraction: kept ${r.kept}, dropped ${r.dropped.length}`, r.dropped);
    }

    if (task.kind === 'catastro') {
      state.tried.add(task.strategy);
      let result;
      try {
        result = await catastro.lookup(world, task.strategy);
      } catch (e) {
        trace.log('catastro', `${task.strategy} failed`, String(e));
      }
      const matches = result ? catastro.match(world, result.units) : [];
      trace.log('catastro', `${task.strategy}: ${result?.units.length ?? 0} units, ${matches.length} match`, { url: result?.url, live: result?.live });
      const v = reviewCatastro(world, result, matches);
      trace.log('critic', v.ok ? 'catastro: one unit identified' : `catastro: ${v.action} — ${v.reason}`);
      if (v.ok) {
        catastro.ingestUnit(world, result!, matches[0], result!.units);
        state.catastroSettled = true;
      } else if (v.action === 'ask') {
        state.catastroSettled = true;
      }
    }

    if (task.kind === 'law') {
      task.attributes.forEach((a) => state.lawTried.add(a));
      try {
        const { missing } = await fetchLaw(world, task.attributes);
        trace.log('law', `fetched ${task.attributes.length - missing.length} rules from the BOE`, { missing });
        if (missing.length) trace.log('critic', 'law text changed: rules not found in force', missing);
      } catch (e) {
        trace.log('law', 'BOE unreachable and not cached', String(e));
      }
    }

    if (task.kind === 'price') {
      state.priceTried = true;
      const r = await lookupReference(world);
      if (!r.ok) {
        trace.log('price', `no reference: ${r.reason}`);
        world.note('price', 'No SERPAVI reference for this area; price check skipped.');
      } else {
        trace.log('price', `SERPAVI ${r.ref.year} ${r.ref.level} ${r.ref.areaCode} via ${r.ref.via}`, r.ref);
        if (r.ref.via !== 'zetaris') {
          trace.log('critic', `price: Zetaris unavailable (${r.error}); used ${r.ref.via}`);
          world.note('critic', `Price reference read from ${r.ref.via} because Zetaris did not answer.`);
        }
        if (r.fellBack) world.note('critic', 'No SERPAVI figure for the district; compared with the whole municipality.');
        if (r.ref.level === 'distrito_censal') trace.log('critic', 'price: Catastro municipal district matched to SERPAVI census district (same in Madrid; check elsewhere)');
        if (r.ref.sampleN < 30) world.note('critic', `SERPAVI figure rests on only ${r.ref.sampleN} leases; treat it as indicative.`);
      }
    }

    if (task.kind === 'check') {
      const findings: Finding[] = [];
      for (const c of CHECKS) {
        const f = c.run(world);
        if (!f) continue;
        const v = reviewFinding(world, f);
        if (!v.ok) {
          trace.log('critic', `dropped ${f.checkId}: ${v.reason}`);
          continue;
        }
        const a = assessConfidence(world, f);
        f.confidence = a.confidence;
        if (a.reasons.length) f.caveats = a.reasons;
        if (a.confidence === 'low') {
          f.needsReview = true;
          trace.log('critic', `${f.checkId}: low confidence, needs a human check`, a.reasons);
        }
        findings.push(f);
      }
      trace.log('checks', `${findings.length} findings`, findings.map((f) => `${f.checkId}:${f.status}`));

      for (const f of findings) {
        let feedback: string | undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
          const text = await explain(llm.generate, world, f, feedback);
          const v = reviewExplanation(world, f, text);
          if (v.ok) {
            f.explanation = text;
            break;
          }
          feedback = v.reason;
          trace.log('critic', `explanation of ${f.checkId} rejected: ${v.reason}`, text);
        }
        if (!f.explanation) {
          f.explanation = f.detail;
          trace.log('critic', `explanation of ${f.checkId}: using the rule outcome`);
        }
      }
      world.findings = findings.sort((a, b) => ORDER[a.status] - ORDER[b.status]);
      email = await writeEmail(llm.generate, world, trace);
      break;
    }
  }

  trace.log('planner', 'done', { findings: world.findings.length, questions: world.questions.length });
  return { ...report(runId, world, trace, llm.name), email };
}

/** Email agent drafts, Risk guard checks; one retry with the reason, then the fixed template. */
async function writeEmail(generate: Generate, world: WorldStore, trace: Trace): Promise<EmailDraft | undefined> {
  const findings = emailFindings(world.findings);
  if (!findings.length) return;
  let feedback: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let draft;
    try {
      draft = await draftEmail(generate, world, findings, feedback);
    } catch (e) {
      feedback = `not valid JSON (${(e as Error).message})`;
      trace.log('riskguard', `email draft rejected: ${feedback}`);
      continue;
    }
    const v = reviewEmail(world, findings, draft);
    if (v.ok) return done(draft, 'model');
    feedback = v.reason;
    trace.log('riskguard', `email draft rejected: ${v.reason}`, draft);
  }
  const t = templateDraft(world, findings);
  const v = reviewEmail(world, findings, t);
  if (!v.ok) {
    trace.log('riskguard', `template rejected too (${v.reason}); no email`);
    return;
  }
  trace.log('riskguard', 'email: using the fixed template');
  return done(t, 'template');

  function done(d: { subject: string; body: string }, via: EmailDraft['via']): EmailDraft {
    trace.log('riskguard', `email draft approved (${via}); waiting for the renter`);
    return { subject: d.subject, cited: d.body, body: stripCitations(d.body), covers: findings.map((f) => f.checkId), status: 'draft', requiresApproval: true, via };
  }
}

function feasible(w: WorldStore, s: catastro.Strategy) {
  if (s === 'reference') return w.has('unit.catastro_ref', ['renter', 'contract', 'listing']);
  if (s === 'coordinates') return w.has('address.lat');
  return w.has('address.street') && w.has('address.number');
}

function ingestAnswers(world: WorldStore, input: Input) {
  const entries = Object.entries(input.answers ?? {});
  if (input.lat != null && input.lon != null) entries.push(['address.lat', String(input.lat)], ['address.lon', String(input.lon)]);
  if (!entries.length) return;
  const src = world.addSource({ kind: 'renter', label: 'Your answer', retrievedAt: new Date().toISOString(), live: true });
  for (const [attr, raw] of entries) {
    const fd = raw.match(/^(\w+)\s*º?\s+(\w+)$/);
    if ((attr === 'address.door' || attr === 'address.floor') && fd) {
      world.addFact({ attribute: 'address.floor', value: fd[1], sourceId: src.id, confidence: 'high' });
      world.addFact({ attribute: 'address.door', value: fd[2], sourceId: src.id, confidence: 'high' });
    } else {
      const n = Number(raw);
      world.addFact({ attribute: attr, value: raw === 'true' ? true : raw === 'false' ? false : Number.isNaN(n) ? raw : n, sourceId: src.id, confidence: 'high' });
    }
  }
}

function report(runId: string, world: WorldStore, trace: Trace, provider: string) {
  const used = new Set(world.findings.flatMap((f) => f.evidence));
  return {
    runId,
    createdAt: new Date().toISOString(),
    provider,
    summary: {
      red: world.findings.filter((f) => f.status === 'red').length,
      amber: world.findings.filter((f) => f.status === 'amber').length,
      unknown: world.findings.filter((f) => f.status === 'unknown').length,
      green: world.findings.filter((f) => f.status === 'green').length,
      needsReview: world.findings.filter((f) => f.needsReview).length,
    },
    findings: world.findings,
    questions: world.questions,
    notes: world.notes,
    facts: world.facts.filter((f) => used.has(f.id)),
    sources: [...world.sources.values()],
    trace: trace.entries,
  };
}

export type Report = Awaited<ReturnType<typeof run>>;
