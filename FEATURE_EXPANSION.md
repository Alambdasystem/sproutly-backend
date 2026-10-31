# Growing companion expansion

Existing Node/SQLite architecture retained. No paid plan or store account is provisioned by this release.

- Personalized seed plans: confirmed packet inputs, customer setup, versioned AI guidance, explicit assumptions, tentative suggested dates. Exact germination windows require printed-confirmed or customer-entered numeric ranges. Indoor-only plans omit outdoor-transition steps.
- Tracking: dated milestones and photos, actual-sowing date adjustment, unfinished reminder rescheduling, completion history, one-time seed-to-plant linking.
- Doctor: account-owned plant/project conversations, relevant saved history, private attachments, explicit AI consent, retry-safe asynchronous jobs. AI proposals only save allowed reminders/observations after customer confirmation.
- Rescue: versioned 14-day plans, day 3/7/14 check reminders, initial/current photo context, qualitative progress, insufficient-evidence handling.
- QR/EAN/UPC decoding reads pixels locally on the backend; QR destinations are never opened. Optional BARCODE_LOOKUP_KEY enables product metadata, never authoritative growing instructions.
- Voice: optional foreground recording, explicit consent, OpenAI transcription, no server audio retention. OPENAI_TRANSCRIBE_MODEL defaults to gpt-transcribe. Spoken output is device opt-in.
- Identification: up to three evidence-backed tentative alternatives; no photo-based edibility assurance. Customer correction explicitly updates species while keeping original assessment.
- Weather: consent and rounded coordinates, attributed seven-day forecast. OPEN_METEO_API_KEY required for real accounts; free endpoint restricted to demo evaluation. Forecasts do not establish frost dates, soil temperatures or hardiness zones.
- Premium: REVENUECAT_SECRET_KEY, REVENUECAT_WEBHOOK_TOKEN, optional REVENUECAT_ALLOW_SANDBOX=true for test purchases. PREMIUM_ENFORCEMENT defaults false: pilot access, no invented paid membership. Native store products/offerings and frontend public SDK keys must be configured before real purchase testing. Server verification, restore refresh, expiry/refund and authenticated replay-safe webhook handling are implemented. No live charges enabled.
- Privacy: authenticated account JSON export (photos optional, 20 MB cap), current-password reauthentication for permanent non-demo deletion, separate app-store cancellation acknowledgement. Live records deleted; existing local backup snapshots age out through retention. No provider deletion beyond local data is claimed.
- Help and operations: user-owned support notes are explicitly not emailed; admin operations scoped to own pilot records. No external crash reporter, offsite backups or verified sender is active without credentials.

## Validation

Automated integration tests exercise real HTTP routes with isolated SQLite databases and stubbed AI responses; QR test decodes actual generated pixels. Tests cover ownership, consent, action confirmation/replay, milestones, conversion, rescue comparison insufficiency, account export/deletion, provider failures, subscription expiry/refunds/sandbox/webhooks. These tests do not establish physical device behavior, medical/botanical accuracy, actual store purchases or a 30–50 real-packet corpus benchmark.

## Release gates

Real manufacturer packet corpus; physical Android/iPhone camera, mic, keyboard, notifications and update acceptance; RevenueCat and store setup; commercial weather/product credentials; verified recovery email; owner-approved offsite backup destination and remote restore rehearsal; final public policies/store privacy declarations; external monitoring and beta acceptance. Commerce remains separate and simulated. APK packaging follows web/API validation.
