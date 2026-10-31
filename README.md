# Sproutly API

Node.js HTTP API with SQLite, account-owned records, server sessions, input validation, immutable history and idempotent writes. Node 22.13+ is required; deployed runtime is Node 24. React Native/Expo clients use `/api/v1`.

```sh
npm ci --include=dev
npm test
npm start
```

Configuration: `PORT` (default 3001), `DATABASE_PATH`, exact comma-separated `CORS_ORIGINS`, and optional `DEMO_ENABLED=false`. Production pilot requires mounted persistent storage and runs verified daily SQLite backups; see OPERATIONS.md. `/health` reports storage and backup readiness. Private photos are in SQLite and included in local backups.

Real routes cover accounts, plants, media, journals, reminders, factual growing stories, seed packets/projects, OCR extraction/review, grow plans/milestones, Doctor conversations/actions, rescue plans/checkpoints, weather, transcription, membership verification, export/deletion and own-account operations. Signed-in requests use `Authorization: Bearer ...`; supported save/AI endpoints require `Idempotency-Key`. Cross-account references are rejected. Asynchronous image/care jobs are polled by ID and survive as saved completed/failed records; interrupted work fails explicitly after restart.

The backend-only `OPENAI_API_KEY` powers real image analysis, reviewed packet extraction, care and short voice transcription. No canned AI fallback is substituted. Explicit customer consent is required; AI responses disclose uncertainty and proposals do not execute arbitrary functions. OpenAI Responses requests use `store:false`; provider retention is governed separately by API terms. Voice recordings are not saved server-side.

Seed extraction includes independently recognized English text, evidence/confidence, correction/confirmation, retained originals and local QR/EAN/UPC decoding. QR destinations are never opened automatically. Product metadata requires `BARCODE_LOOKUP_KEY`. Weather requires `OPEN_METEO_API_KEY` for real accounts; demo gardens can evaluate the free provider endpoint after approximate-coordinate consent. Forecasts do not establish frost dates or soil temperatures.

RevenueCat verification and native store integration require runtime/project/store configuration. `PREMIUM_ENFORCEMENT` defaults false; pilot access is not paid membership. No live physical-commerce charge or seller payout is enabled. Sample catalog, checkout, orders, inventory and admin reviews remain isolated demo data. The separately attributed merchant search reads Deep Harvest Farm's public catalog and leaves checkout to the merchant; GBIF provides optional taxonomy references, not inventory.

`REQUEST_METRICS=true` records request ID, method, status and duration without request bodies, paths, coordinates, tokens or photos. Daily quotas limit expensive AI operations. Account export excludes credentials; deletion reauthenticates real accounts and removes live records. Existing backup snapshots expire through retention and app-store subscriptions require separate cancellation.

See FEATURE_EXPANSION.md for configuration, routes and feature limits; PACKET_SCANNING.md for extraction evidence; INTEGRATIONS.md for guarded Stripe sandbox, sender and offsite adapters. Verified email delivery, offsite remote restore, real store purchase acceptance, real packet/plant evaluations, physical devices, final policies and external crash/availability alerts remain release gates.
