# Stockwise

A local hackathon prototype for demand forecasting and inventory planning, with a Meta Model API copilot. Restaurant/café mode translates dishes into raw ingredients. Retail mode plans finished-product replenishment.

## Run

Requires **Node.js 24 or newer**. The app has **no npm dependencies**.

```powershell
cd C:\Users\chamr\Desktop\Gayathri\Meta
node --env-file-if-exists=.env src/server.js
```

Open http://127.0.0.1:3000. `start.ps1` also launches it; `start.cmd` works by double-clicking. If Node is not on PATH, install Node 24 from https://nodejs.org or use the bundled runtime detected by the launcher.

```powershell
node --test tests/*.test.js
```

## Connect Meta

1. Copy `.env.example` to `.env`.
2. Set `META_API_KEY` locally, without quotes or spaces around `=`. Do not commit or share it.
3. Set `META_MODEL` to a model enabled in your Meta account. The default, `muse-spark-1.3`, follows Meta's current published documentation; your credit and model entitlement are not verified until a request succeeds.
4. Restart the server and ask a question in **Ask Stockwise**. A successful live response shows model ID, latency, token usage, and tool results. An API failure switches to an explicitly labeled local summary.

Official references: https://dev.meta.ai/docs/protocols/chat-completions and https://dev.meta.ai/docs/models (consulted 4 November 2026).

The browser never receives the key. Requests go from the Node backend to `https://api.meta.ai/v1/chat/completions`. Each question is limited to 4 model rounds, 2,400 completion tokens (including reasoning) per round, low reasoning effort, a 45-second overall timeout, and 6 tools per round. One assistant request can run at a time. The app does not enforce a dollar budget or check your credit balance. A live Muse Spark 1.3 tool loop was verified on 4 November 2026; the recorded diagnostic run used 3,191 tokens and took 10.62 seconds. Your Meta balance was not queried.

## Demo flow

1. Open the synthetic restaurant dashboard.
2. Inspect **Demand forecast**, the 7/14-day horizon, and held-out baseline comparison.
3. Open **Stock & recipes**. Notice expiry, inbound delivery dates, recipe v1.0, and 80% trimming yields.
4. Open **Purchase planner**. Inspect required quantity, safety, allocated stock, used inbound, shortfall, packs, and deadline.
5. Set demand scenario to +25%. Quantities recalculate; this is an explicit user scenario, not a learned promotion effect.
6. Ask the assistant why rice is needed; expand tool evidence. Without a key the answer is clearly labeled local fallback.
7. Switch to retail mode. Export a CSV purchase draft.
8. Import `samples/food-sales.csv` or `samples/retail-sales.csv` into the matching mode; import errors identify rows. Reset restores synthetic samples and records the reset in the audit log.

## Architecture

`Browser HTML/CSS/JS → local Node HTTP API → deterministic planning modules + SQLite`

`Ask Stockwise → Meta Model API → allowlisted read-only tools → plan snapshot → model explanation`

- `src/engine.js`: same-weekday forecast, moving-average fallback, rolling-origin backtests, units, recursive approved recipes, FEFO daily stock allocation, purchasing policy.
- `src/copilot.js`: bounded Meta tool loop; `get_forecast`, `get_purchase_plan`, `get_recipes`; no arbitrary SQL, writes, or access to another mode through tool parameters.
- `src/imports.js`: CSV parser, row validation, duplicate file hash.
- `src/server.js`: API, SQLite snapshots/audit/import hashes, CSV export, localhost-only serving, cross-origin rejection.
- `src/seed.js`: reproducible synthetic sample history, recipes and stock.
- `data/stockwise.sqlite`: local durable workspace, created on first run and ignored by Git. Snapshot date persists until reset. Make a copy before importing valuable records.

## Calculation policy

The app forecasts the next 7 or 14 days. Replenishment covers each supplier's **lead time + review period**, currently two days in the sample data. The forecast and purchasing horizons are intentionally different.

The same-weekday forecast averages up to 8 prior observations; with fewer than 3 matching weekdays it uses up to 14 recent observations. Unavailable days are excluded. Missing dates are not zero-filled. Confidence is a sample-count heuristic. The range is mean ±1.64 population standard deviations, clipped at zero, and is **not calibrated**. Aggregate ranges sum item bounds; they are not joint probability intervals. Backtests use earlier data only on the last 14 dates, report WAPE/MAE/bias/coverage, and omit WAPE when total actual quantity is zero. Sales are aggregated per date/item; returns and missing-date remediation require upstream preparation.

Approved recipe weights convert g→kg and ml→l. Prepared quantities divide by preparation yield; purchase-basis weights do not. Nested recipes specify output servings using `unit`; cycles and unknown units are rejected. There is no recipe editor in this prototype.

FEFO stock allocation excludes expired and reserved quantities, applies dated receipts, and preserves earlier shortages even when later deliveries arrive. A percentage safety allowance is added on the last day of the protection period. Positive shortfalls round up to packs and minimum orders. Displayed `usable` and `inbound` values are **allocated amounts**, not total physical inventory; inspect Stock & recipes for full lots. Pack overage assumes the new order is usable throughout the protection period; new-order shelf-life optimization is not modeled. Delivery risk is flagged when normal lead time cannot meet the first need date. Orders remain drafts and are never sent to suppliers.

## Boundaries

This is a **single-user, local-only prototype**, not the full 12-week production plan. It binds to loopback and has no login, tenant authentication, roles, cloud hosting, hotel booking connector, POS integration, production stock ledger, automated import rollback, recipe editing, or live supplier ordering. Do not expose it publicly as-is. Imports replace matching item/date records atomically at the logical validation step; invalid files leave sales unchanged. Import hashes prevent replay of the same validated rows. The audit log records counts and hashes, not a full rollback image. Reset is the available demo recovery path.

Sample recipes, costs, and sales are synthetic and do not establish commercial savings, forecast accuracy on real businesses, or official hackathon eligibility. Imported sales may coexist with remaining sample rows; the UI flags this mixed provenance. An offline assistant summary is not evidence of live Meta usage. Generated model prose is untrusted and needs owner review; numerical tools are deterministic, but there is no formal factual verifier of final prose.

## Submission and video

See `docs/submission.txt` for project description and Meta-use answers, `docs/video-storyboard.json` for the 180-second narration plan, and `docs/verification.txt` for observed checks. The video is a full-screen, product-only narrated screenshot walkthrough, including a verified live Meta answer and visible tool results. Tall pages pan vertically to show the app without an external presentation background, slide titles, or borders. The final narration uses ElevenLabs; speech generation requires a key with Text to Speech permission.

`scripts/narrate.ps1` generates local Windows narration. `scripts/elevenlabs.mjs` is an optional ElevenLabs alternative using environment credentials. `scripts/render_video.py` assembles screenshots and narration with FFmpeg, needed only for video production, not the app. Rendering defaults to the saved ElevenLabs MP3 segments; pass `--voice-format wav` for local narration.
