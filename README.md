# Before you pay the deposit

We are building an agent that helps **people renting a flat in Spain** avoid paying a deposit
for a flat that isn't what the listing says, by **cross-checking the listing against public
records and the law** using **the listing, Catastro, SERPAVI and the LAU (federated through
Zetaris)**, producing **a report of discrepancies, each with its source, and the questions to
ask the landlord before paying**.

Open Agent Hackathon 2026 · Track 1, Solving Fragmented Intelligence.

```
$ npm run check -- examples/argumosa-3c.listing.txt

● ADVERTISED SIZE VS CATASTRO  [red]
  Advertised 72 m², Catastro records 56 m² construidos: 29% more than on record.
  sources: Listing | Catastro, ref. 0835114VK4703F0022QQ
  ask: Catastro has this flat at 56 m². Where do the other 16 m² come from, and are they legalised?

● FIANZA (DEPOSIT)  [red]
  Asks for 2 months of fianza; the law sets 1 month for housing.
  sources: Listing | LAU art. 36 in force since 2026-10-08 (BOE-A-2026-20823)
...
◐ RENT VS WHAT PEOPLE PAY NEARBY  [amber]
  1450 € for 56 m² on record is 25.89 €/m²; in this area half of leases pay under 17.7 €/m²
  and three in four under 21.78 €/m².
  sources: Listing | Catastro | SERPAVI 2024, Madrid census district 01 (via zetaris)
```

## Run it

Node 24+, no build step.

```bash
npm install
npm test                                           # offline, no keys, no Zetaris
npm run check -- examples/argumosa-3c.listing.txt  # live Catastro + BOE
npm run check -- examples/argumosa-3.listing.txt   # asks which flat
npm run check -- examples/argumosa-3.listing.txt --answer 'address.door=3º C'
OFFLINE=1 npm run check -- examples/argumosa-3c.listing.txt   # saved copies only
```

`--contract file.txt` adds a contract; `--json out.json` writes the full report (findings,
questions, facts, sources, trace) for the UI. Copy `.env.example` to `.env` to choose the
model and connect Zetaris.

## How it works

The rule everywhere: **the checks are plain code; the model only extracts and explains, and
cites a fact for everything it says.** The critic enforces that rule in code.

| Role | Kind | Does |
|---|---|---|
| Planner | code | Reads the world state and picks the next step. No fixed order: a listing with a Catastro reference skips the address lookup; a missing door stops the size check and asks. |
| Extractor | LLM | Listing/contract → fields, each with the verbatim quote that supports it. |
| Catastro | code | Finds the registered unit (reference → address → normalised address → coordinates). |
| Law | code | Fetches the LAU articles in force today from the BOE API. Each rule is bound to a sentence that must exist word for word in that version. |
| Price | code | SERPAVI reference rents through **Zetaris**; local CSV if Zetaris does not answer. |
| Checks | code | Size, use, fianza, additional guarantee, rent insurance, agency fees, IBI, price, listing vs contract. |
| Critic | code | After every step: drops extractions whose quote is not in the document or does not contain the value; retries Catastro another way or asks the renter; rejects explanations that cite facts outside the evidence or use numbers not in it; flags cached sources and small samples. |
| Explainer | LLM | Two plain sentences per finding, from the facts the ContextBuilder hands it. |

Everything lands in one **World Model**: facts with their source, quote and confidence.
Each step is written to `logs/<run>.jsonl` and returned as `trace` in the report.

### Recovery, not a fixed pipeline

- Catastro has 7 flats on the floor and the listing says no door → the agent asks which one
  (with the 7 options) instead of picking one.
- Catastro or the BOE is down → the last saved answer is used, marked as cached.
- Zetaris is down → the price check reads the local CSV and says so.
- The law changes (RDL 29/2026 still needs Congress to validate it) → the rule sentence is
  not found in the version in force and the check says "unknown", not stale law.
- The model invents a number or a citation → the explanation is rejected, retried once with
  the reason, then replaced by the rule outcome.

## Sponsors

**Zetaris (required).** `docker-compose.yml` runs a small Postgres (`byp-db`) on the Zetaris
platform's network. Zetaris federates it as datasource `byp_pg`, and the price specialist
queries `byp_pg.serpavi_rent` through the Zetaris REST API on every run
(`src/sources/zetaris.ts`, `src/sources/serpavi.ts`). Setup:

```bash
docker compose up -d                  # byp-db, joins zetaris_default
python3 scripts/prepare_serpavi.py data/serpavi/serpavi_2011-2024.xlsx data/serpavi/serpavi_long.csv
./scripts/load-db.sh
# in Zetaris (SQL editor or REST):
#   CREATE DATASOURCE byp_pg DESCRIBE BY "Before_you_pay records" OPTIONS (jdbcdriver "org.postgresql.Driver",
#     jdbcurl "jdbc:postgresql://byp-db:5432/byp", username "byp", password "byp-local", fetchsize "1000")
#   REGISTER DATASOURCE TABLES FROM byp_pg
```

Fallback: when `ZETARIS_USER` is unset or the query fails, the same rows are read from the
local CSV (or `data/sample/`); the report and the trace say which path was used.

**Meterless (required).** Engine used: **World Model** (WorldStore + IngestPipeline +
ContextBuilder), implemented in `src/world/`. The store holds every fact with provenance;
the specialists' `ingest*` functions are the ingest pipeline; `buildFindingContext` is the
only way the model sees the world. The model is injected (`src/llm/provider.ts`), there is a
sample mode with no credentials, and evidence is written as JSONL to `logs/`.

**Cursor (required).** The project is developed in Cursor, with Claude Code running in
Cursor's terminal.

**NVIDIA (optional).** `LLM_PROVIDER=nvidia` runs extraction and explanations on Nemotron
via NIM.

## Data

| Source | Access | Used for |
|---|---|---|
| Catastro (OVC web services) | live, free, no key | surface, use, year, floor/door, INE municipality, district |
| BOE consolidated legislation API | live, free, no key | LAU arts. 20 and 36, version in force |
| SERPAVI 2011-2024 (MIVAU) | downloaded, via Zetaris | reference rent €/m² by census district and municipality |

SERPAVI comes from rents declared in income tax: it is a reference of what is paid, not a
legal cap and not asking prices. Example listings are synthetic (real buildings so Catastro
answers; invented text, prices and conditions). No personal data.

## Prior components

None. All code was written in the hackathon window (from 22 Oct 2026). Planning documents
(idea, data sources, agent variants) were prepared before and are declared in the submission.
