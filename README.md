# Casa · Before you pay the deposit

We are building an agent that helps **people renting a flat in Spain** avoid paying a deposit
for a flat that isn't what the listing says, by **cross-checking the listing against public
records and the law** using **the listing and contract, Catastro, SERPAVI and the LAU in force
(federated through Zetaris)**, producing **a report of discrepancies, each with its source,
and a polite email to the landlord with the questions to ask before paying**, which the
renter approves and sends.

Open Agent Hackathon 2026 · Track 1, Solving Fragmented Intelligence.

## Demo Video

Demo video: https://iframe.mediadelivery.net/embed/778121/debca8ee-f5de-4942-a2b8-5c995c3658e0

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
npm run check -- examples/argumosa-3c.scam.listing.txt                     # scam signals
npm run check -- examples/argumosa-3c.scam.listing.txt --photo 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200'   # + photo on 69 other pages (Bright Data)
npm run check -- examples/argumosa-3c.listing.txt --contract examples/contract-contradicts-listing.pdf
OFFLINE=1 npm run check -- examples/argumosa-3c.listing.txt   # saved copies only
```

Web page and API:

```bash
API_KEY=dev npm start                 # API on :3000 — POST /check (X-API-Key), GET /health
CHECK_API_URL=http://127.0.0.1:3000 CHECK_API_KEY=dev npm run ui   # page on http://127.0.0.1:4173/
```

`npm run ui` serves the report page and proxies Generate to `POST /check`, so the key never
reaches the browser. Without `CHECK_API_URL` it uses the deployed API
(`https://before-you-pay.onrender.com`, free plan: the first request wakes it up, ~20 s).
`POST /check` takes `listing`, and optionally `contract` (text), `contractPdfBase64`,
`photos` and `answers` (to reply to a question), and returns the report as JSON.

`--contract` takes a contract as text or PDF (text layer; scanned PDFs need OCR).
`--json out.json` writes the full report (findings, questions, facts, sources, email draft,
trace) for the UI; `--markdown out.md` writes it as a document. Real reports are in
[`examples/`](examples/README.md). Copy `.env.example` to `.env` to choose the
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
| Photos | code | Each listing photo through Google Lens (**Bright Data** SERP API): pages where the same image appears. Stock-photo or holiday-rental sites, or a listing in another city, feed the scam check. |
| Checks | code | Size, use, fianza, additional guarantee, rent insurance, agency fees, IBI, price, listing vs contract, scam signals (money before the visit, no visit or keys by courier, Western Union or crypto, landlord abroad, rent far under the area's cheapest quarter). |
| Critic | code | After every step: drops extractions whose quote is not in the document or does not contain the value; retries Catastro another way or asks the renter; rejects explanations that cite facts outside the evidence or use numbers not in it; flags cached sources and small samples. Rates each finding's confidence from its evidence (saved copies, old copies, small SERPAVI samples, listing and contract disagreeing on the figure used) and sends low ones to human review: flagged in the report, kept out of the email. |
| Explainer | LLM | Two plain sentences per finding, from the facts the ContextBuilder hands it. |
| Email agent | LLM | Drafts a polite email in Spanish to the landlord or agency asking each red and amber question. Draft only: nothing is sent, the renter approves and sends it. |
| Risk guard | code | Checks that draft: every red finding covered, citations and numbers from the evidence only, no accusations, threats or ultimatums, nothing that commits the renter, no phones, emails, IDs or IBANs. Retries the model with the reason, then falls back to fixed wording. |

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
ContextBuilder), implemented in `src/world/`.

- *WorldStore* (`src/world/store.ts`): every fact the agents learn, with its source, verbatim
  quote and confidence. Agents never pass data to each other directly; they read and write
  the world, and the planner chooses the next step from what is in it.
- *IngestPipeline*: the specialists' `ingest*` functions (`src/agents/extractor.ts`,
  `catastro.ts`, `law.ts`, `price.ts`) turn each source into facts; the critic reviews every
  batch before anything uses it.
- *ContextBuilder* (`src/world/context.ts`): the only view the model gets, the facts behind
  one finding with their ids and citations. That is why the critic can reject any number or
  citation that is not in it.

The model is injected (`src/llm/provider.ts`), there is a sample mode with no credentials,
and evidence is written as JSONL to `logs/`.

**Cursor (required).** The project lives in Cursor: Claude Code runs in Cursor's terminal for
most of the code, and Cursor's own agent built the Markdown export (`src/render/markdown.ts`
and its test, commit `0b05161`).

**Bright Data (optional).** The photos specialist (`src/agents/photos.ts`,
`src/sources/brightdata.ts`) sends each listing photo to Google Lens through the Bright Data
SERP API and records the pages where the same image appears. Set `BRIGHTDATA_API_TOKEN` and
`BRIGHTDATA_SERP_ZONE`; pass photos with `--photo <url>` or `photos: [...]` in `POST /check`.

**NVIDIA (optional).** NVIDIA Nemotron on NIM is the model of the demo
(`LLM_PROVIDER=nvidia`, default `nvidia/nemotron-3.5-lightning-30b-a3b`): extraction with
quotes, explanations and the email draft. Thinking is turned off
(`chat_template_kwargs.enable_thinking: false`) because the reasoning is done by the code;
a full run takes about 25 s. Claude (`LLM_PROVIDER=anthropic`) is supported as an
alternative. Everything Nemotron produces goes through the critic or the Risk guard: in
`examples/argumosa-3c.report.json` the critic rejects two of its price explanations (no
citation; invented numbers) and the report shows the rule outcome instead.

## Data

| Source | Access | Used for |
|---|---|---|
| Catastro (OVC web services) | live, free, no key | surface, use, year, floor/door, INE municipality, district |
| BOE consolidated legislation API | live, free, no key | LAU arts. 20 and 36, version in force |
| Listing and contract | pasted text or PDF | the terms, each with its verbatim quote |
| SERPAVI 2011-2024 (MIVAU) | downloaded, via Zetaris | reference rent €/m² by census district and municipality |

SERPAVI comes from rents declared in income tax: it is a reference of what is paid, not a
legal cap and not asking prices. Example listings and contracts are synthetic (real buildings so Catastro
answers; invented text, prices and conditions). No personal data.

## Prior components

None. All code was written in the hackathon window (from 22 Oct 2026). Planning documents
(idea, data sources, agent variants) were prepared before and are declared in the submission.
