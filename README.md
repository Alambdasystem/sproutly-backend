# Sproutly backend
Real Node.js HTTP API with SQLite storage, server-side sessions, validation, ownership checks, role checks and seeded demo records. Node 22.13+ required; no runtime npm dependencies.

## Run
`npm start` starts on PORT (default 3001). `npm test` runs integration tests with isolated in-memory databases. `/health` is a readiness endpoint.

## Configuration
- `DATABASE_PATH`: default `data/sproutly.sqlite`. Use a persistent volume path for durable hosting.
- `CORS_ORIGINS`: comma-separated exact frontend origins.
- `DEMO_ENABLED=false`: disables creation of new demo gardens.

Each demo garden has its own account and isolated sample catalog, provider reviews, inventory and orders. Its admin scope is limited to that account's sample workspace. Registered accounts always begin as growers. Marketplace commerce is currently an isolated demo, not a shared multi-seller production marketplace.

## API
All application endpoints are under `/api/v1`. Register/login/demo return a bearer session token. Send `Authorization: Bearer <token>` for authenticated requests.

- POST `/auth/demo`, `/auth/register`, `/auth/login`, `/auth/reset`; POST `/auth/logout`
- GET `/me`, `/bootstrap`
- GET/POST `/plants`; GET/PATCH/DELETE `/plants/:id`
- POST `/media`; GET `/media/:id` (authenticated)
- POST `/journal`; PATCH/DELETE `/journal/:id`
- POST `/tasks`; PATCH `/tasks/:id`
- POST `/assessments`; GET `/assessments/:id`
- POST `/stories`; PATCH `/stories/:id`
- GET/POST `/listings`; PATCH `/listings/:id`
- POST `/checkout` with `Idempotency-Key` and `{items:[{listingId,quantity}]}`
- PATCH `/orders/:id` with `{status}`
- POST `/providers`; PATCH `/admin/providers/:id`; DELETE `/admin/listings/:id`

Checkout uses server prices, a transaction, stock checks, and idempotency. Cancellation/refund restores stock once. Photos are private authenticated database records (maximum roughly 4 MB). For production, move images to private object storage, strip image metadata server-side, and add malware/content checks.

Photo assessments now call the OpenAI Responses API using the backend-only OPENAI_API_KEY and OPENAI_VISION_MODEL (default gpt-5.4-mini). POST /assessments requires mediaId, consent:true and Idempotency-Key, returns HTTP 202 with a job ID; poll GET /assessments/:id for queued/running/completed/inconclusive/failed. No canned fallback is used. API errors preserve the uploaded photo. A daily global quota and per-account quota limit usage. OpenAI store:false is requested; review OpenAI data-retention terms separately. The structured response includes visible observations, tentative identification, evidence, uncertainty, questions, actions and follow-up timing. Stories concatenate real saved journal entries without inventing facts. Payments, seller payouts, email verification/reset delivery, and external notification delivery are not connected. No payment data is collected.

Free Render instances have ephemeral disk; records survive requests and ordinary process restarts on the same filesystem but can reset on instance replacement or deployment. Use a persistent disk or managed database before keeping valuable records. Seeded demo data is recreated for each new demo session.


## Catalog and live reference data
The catalog contains 24 explicitly labeled sample offers across herbs, vegetables, flowers and houseplants. Catalog migration preserves existing seeded inventory. Prices, sellers, stock and pickup are demonstration data. GET /plant-search?q=... performs a server-side GBIF plant-taxonomy search, cached for 24 hours with source records and timestamps. GBIF records are never treated as sale inventory. Perenual and Trefle require separate credentials; Kindwise is an optional specialist plant-ID service. A merchant feed or inventory API is needed for real seed/plant stock and pricing.

## Live merchant catalog
Authenticated GET `/api/v1/marketplace/search?q=basil&page=1` reads Deep Harvest Farm' public WooCommerce Store API. No API key is needed. Responses preserve merchant currency, minor units, price ranges, source links, availability, and retrieval time. Search pages 1–5 contain up to 12 products each. Results are cached for 15 minutes; concurrent identical requests share a request. Provider failures return 502, never sample substitutes. Product links are fixed to the merchant domain. No merchant carts, orders, payments, or customer data are sent. Checkout occurs on the merchant site; this integration implies no affiliation or merchant agreement. Perenual, Trefle, Kindwise, and eBay are not configured.

The initial Strictly Medicinal Seeds adapter was verified in development but returned HTTP 403 from Render, so it is not used. Deep Harvest Farm is the active public seed catalog. No requests attempt to bypass a merchant access restriction. Live potted-plant inventory is not connected.

## Prepared persistence and recovery
`storage.mjs` can require an actual persistent mount before opening the database. `backup.mjs` provides scheduled native SQLite backups, checksum and integrity verification, an independent restore probe, seven-snapshot retention, and non-overwriting restore commands. Private photos are stored in SQLite and included in each backup. See [OPERATIONS.md](OPERATIONS.md) for activation, temporary-data preservation limits, off-site backup requirements, and the remaining live/device acceptance checks. The deployed pilot was activated on 2026-10-31 UTC with paid compute, a 1 GB disk mounted at `/var/data`, required persistent storage, and verified daily backups. See OPERATIONS.md for acceptance evidence and remaining operational work.
