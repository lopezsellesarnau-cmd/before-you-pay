import { appendFileSync, mkdirSync } from 'node:fs';

// Evidence log: one JSON line per agent step in logs/<run>.jsonl. The same entries go
// into the report as `trace`, so the UI can show how the answer was reached.

export interface TraceEntry {
  t: string;
  step: number;
  agent: string;
  action: string;
  detail?: unknown;
}

export class Trace {
  entries: TraceEntry[] = [];
  private file: string;
  private step = 0;

  runId: string;

  constructor(runId: string) {
    this.runId = runId;
    const dir = new URL('../logs/', import.meta.url).pathname;
    mkdirSync(dir, { recursive: true });
    this.file = `${dir}${runId}.jsonl`;
  }

  log(agent: string, action: string, detail?: unknown) {
    const e = { t: new Date().toISOString(), step: ++this.step, agent, action, detail };
    this.entries.push(e);
    appendFileSync(this.file, JSON.stringify(e) + '\n');
    if (process.env.VERBOSE) console.error(`  ${String(e.step).padStart(2)} ${agent.padEnd(10)} ${action}`);
  }
}
