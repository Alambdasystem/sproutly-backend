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

Assessments explicitly return simulated guidance and do not analyze images. Stories concatenate real saved journal entries without inventing facts. Payments, seller payouts, email verification/reset delivery, and external notification delivery are not connected. No payment data is collected.

Free Render instances have ephemeral disk; records survive requests and ordinary process restarts on the same filesystem but can reset on instance replacement or deployment. Use a persistent disk or managed database before keeping valuable records. Seeded demo data is recreated for each new demo session.
