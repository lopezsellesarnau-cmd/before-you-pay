# Examples

Synthetic listings written for the demo. The buildings are real (so Catastro answers),
the listing text, prices and conditions are invented. No personal data.

| File | Shows |
|---|---|
| `argumosa-3c.listing.txt` | Size inflated vs Catastro, double fianza, agency fees, rent insurance, IBI to tenant |
| `argumosa-3.listing.txt` | Listing omits the door: the agent asks which flat before checking the size |
| `argumosa-3c.scam.listing.txt` | Scam pattern: pay before the visit, Western Union, keys by courier, landlord abroad, 550 € for 56 m² |
| `contract-*.pdf` | Fictitious contracts (abusive clauses, excessive guarantee, contradicts the listing), for `--contract` |

## Report JSON (for the UI)

Real outputs (Nemotron + live Catastro/BOE + SERPAVI via Zetaris), made with `--json`:

| File | Screen state |
|---|---|
| `argumosa-3c.report.json` | Full report: 5 red, 1 amber, 1 ok, plus the email draft. The critic rejects two price explanations (see `trace`) |
| `argumosa-3.question.report.json` | The agent asks which flat (7 options) before checking size and price |
| `argumosa-3.answered.report.json` | Same listing after answering `3º C` |
| `argumosa-3c.scam.report.json` | Scam signals: one red finding, the email only asks to visit and sign before paying |

Shape:

- `summary`: counts by status (`red`, `amber`, `unknown`, `green`), plus `needsReview`.
- `findings[]`: sorted red → green. `title`, `status`, `explanation` (plain text with `[fN]` citations), `question` (what to ask the landlord), `evidence` (fact ids), `confidence` (`high`/`medium`/`low`), `caveats` (why it is not high), `needsReview` (low confidence: show "check this yourself"; these are left out of the email).
- `facts[]`: the facts behind the findings. `attribute`, `value`, `unit`, `quote` (verbatim from the listing or the law), `sourceId`, `confidence`.
- `sources[]`: `label`, `url`, `version` (e.g. the BOE norm in force), `live` (false = saved copy).
- `questions[]`: what the agent needs from the renter. `text`, `options`, `attribute` (send the answer back as `answers: { [attribute]: option }`).
- `notes[]`: caveats from the critic or planner.
- `email`: draft to the landlord or agency, in Spanish, only when there are red or amber findings. `subject`, `body` (ready to copy, no citations), `cited` (same text with `[fN]`), `covers` (check ids), `via` (`model` or `template`), `requiresApproval: true`. Nothing is ever sent: the renter edits it and sends it themselves. Risk guard rejections show up in `trace` (agent `riskguard`).
- `trace[]`: each agent step in order (`agent`, `action`, `detail`), for the "how it reasoned" panel. Critic rejections show up here.

To link a citation `[f12]` to its source: find `f12` in `facts`, then its `sourceId` in `sources`.
