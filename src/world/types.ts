// The shared world state every agent reads from and writes to.
// Meterless engine: World Model (WorldStore + IngestPipeline + ContextBuilder).

export type SourceKind = 'listing' | 'contract' | 'catastro' | 'serpavi' | 'boe' | 'renter';

export interface Source {
  id: string;
  kind: SourceKind;
  label: string;
  url?: string;
  retrievedAt: string;
  /** Legal text version, dataset year, etc. Shown next to the citation in the report. */
  version?: string;
  /** false when the answer came from the local cache because the live service failed. */
  live: boolean;
}

export type Value = string | number | boolean;
export type Confidence = 'high' | 'medium' | 'low';

export interface Fact {
  id: string;
  /** Dotted name, e.g. `unit.area_m2`, `terms.deposit_months`, `law.max_deposit_months`. */
  attribute: string;
  value: Value;
  unit?: string;
  sourceId: string;
  /** Verbatim span of the source that supports the value. Required for extracted facts. */
  quote?: string;
  confidence: Confidence;
}

export type Status = 'red' | 'amber' | 'green' | 'unknown';

export interface Finding {
  checkId: string;
  status: Status;
  title: string;
  /** Deterministic one-line statement built by the check, with the numbers. */
  detail: string;
  /** Facts the verdict rests on. The critic rejects findings without them. */
  evidence: string[];
  /** What to ask the landlord or agency before paying. */
  question?: string;
  /** Plain-language explanation written by the explainer, grounded in `evidence`. */
  explanation?: string;
}

export interface Question {
  id: string;
  /** Attribute the answer fills in. */
  attribute: string;
  text: string;
  options?: string[];
  reason: string;
}
