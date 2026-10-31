# Phase 1: seed and care foundations

Additive tables: foundation_records (owner, kind, revision, JSON body), foundation_versions (immutable snapshots), foundation_messages (user observations attached to a conversation). Existing garden records are retained. Native SQLite backups include these tables.

Authenticated endpoints under /api/v1: seed-packets, seed-projects, conversations, grow-plans, rescue-plans. GET collection/detail, POST collection, PATCH detail with the current revision. GET /:resource/:id/versions retrieves history. Conversations additionally expose GET/POST /conversations/:id/messages. Messages accepted from clients are always user messages; this phase does not generate AI responses.

All links resolve in the authenticated user's records. Updates require optimistic revision checks. Sources distinguish packet, manufacturer, extension, reference and AI guidance. Record links are immutable to prevent mixed histories. Plant deletion returns 409 when foundation history refers to it; the later account/deletion workflow must handle dependent records transactionally. Lists currently return up to 200 records and messages up to 500; pagination is required before broad rollout.

This phase stores draft plan instructions only. OCR extraction, AI plan generation, rescue checkpoints, reminders, entitlements and frontend screens are subsequent phases. No new paid provider or credentials are required here.

Validation: npm test includes database reopen persistence, cross-user read/write/link isolation, source/date validation, immutable links, stale revision rejection, message-role forgery prevention, authenticated HTTP roundtrips and existing API regression tests.
