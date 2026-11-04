# Stockwise hosted demo

Public demo: https://stockwise-metahackthon.cipl-5060.chatgpt.site
Main project and local app: https://github.com/GayathriChilukuri/MetaHackthon

This deployment keeps the original Stockwise interface and numerical planning engine. The Sites/Vinext Worker serves the UI and API, Cloudflare D1 stores isolated demo workspaces, and Meta Muse Spark 1.3 calls read-only planning tools. Each browser receives an opaque HttpOnly demo-workspace cookie; this is a synthetic-data demo rather than a production account system. Separate browsers cannot read each other's records.

The Meta key is a hosted server secret. The hosted app allows 5 Meta questions per browser per UTC day and 30 shared questions per UTC day. Counters persist in D1. Each question retains the bounded model/tool loop from the local app. Quota exhaustion or provider failure returns an explicitly local planning summary. These request limits are not a currency-denominated spending cap.

Use sample or non-sensitive data. Forecasting, stock changes, import, export, and reset remain usable independently of Meta. Orders are drafts and no supplier orders are placed. Production account management, commercial validation, and hotel/POS integrations remain future work.

## Development

Install using the Sites install helper and build using its build helper. The preserved starter supports `npm run dev`, `npm run build`, and `npm start`. The app-specific API lives in `lib/stockwise/hosted.js`; the original planning modules are beside it. `worker/index.ts` routes the existing app before the framework handler while preserving the starter's connector and Sites build integrations.

`node --test tests/hosted.test.mjs` checks browser isolation, imports, audit scoping, bad stock dates, cross-origin rejection, and persistent AI limits. D1 migrations are in `drizzle/`. Hosted secrets are managed through Sites; never add credentials to the manifest or source. `.env.example` documents the supported keys.

The deployment has its own Sites-managed source repository. Its exact project ID is persisted in `.openai/hosting.json`.
