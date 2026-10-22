import type { Fact, Finding, Question, Source, Value } from './types.ts';

export class WorldStore {
  sources = new Map<string, Source>();
  facts: Fact[] = [];
  findings: Finding[] = [];
  questions: Question[] = [];
  /** Notes the critic leaves for the planner: retries, downgrades, gaps. */
  notes: { agent: string; text: string }[] = [];
  private seq = 0;

  addSource(s: Omit<Source, 'id'> & { id?: string }): Source {
    const src = { ...s, id: s.id ?? `src_${s.kind}_${++this.seq}` };
    this.sources.set(src.id, src);
    return src;
  }

  addFact(f: Omit<Fact, 'id'>): Fact {
    const fact = { ...f, id: `f${++this.seq}` };
    this.facts.push(fact);
    return fact;
  }

  removeFact(id: string) {
    this.facts = this.facts.filter((f) => f.id !== id);
  }

  fact(id: string) {
    return this.facts.find((f) => f.id === id);
  }

  /** All facts for an attribute, optionally limited to some source kinds. */
  all(attribute: string, kinds?: Source['kind'][]): Fact[] {
    return this.facts.filter(
      (f) => f.attribute === attribute && (!kinds || kinds.includes(this.sources.get(f.sourceId)!.kind)),
    );
  }

  /** Best fact for an attribute: renter answers win, then contract, then listing, then records. */
  get(attribute: string, kinds?: Source['kind'][]): Fact | undefined {
    const rank: Record<Source['kind'], number> = { renter: 0, contract: 1, listing: 2, catastro: 3, serpavi: 3, boe: 3 };
    return this.all(attribute, kinds).sort(
      (a, b) => rank[this.sources.get(a.sourceId)!.kind] - rank[this.sources.get(b.sourceId)!.kind],
    )[0];
  }

  value<T extends Value>(attribute: string, kinds?: Source['kind'][]): T | undefined {
    return this.get(attribute, kinds)?.value as T | undefined;
  }

  has(attribute: string, kinds?: Source['kind'][]) {
    return this.all(attribute, kinds).length > 0;
  }

  sourceOf(f: Fact) {
    return this.sources.get(f.sourceId)!;
  }

  ask(q: Omit<Question, 'id'>) {
    if (this.questions.some((x) => x.attribute === q.attribute)) return;
    this.questions.push({ ...q, id: `q${++this.seq}` });
  }

  note(agent: string, text: string) {
    this.notes.push({ agent, text });
  }
}
