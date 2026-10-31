# Seed packet scanning — Phase 3

The existing Node/SQLite/Render stack is retained. English Tesseract OCR uses bundled language data from npm (no production language download). Sharp validates image decoding, limits input to 24 megapixels, normalizes orientation, supports explicit 90-degree rotations and percentage crops, strips metadata, and preserves original photo records. OCR text blocks and their bounding boxes are retained with the private extraction record.

OpenAI receives only the selected packet images, side labels and OCR after explicit consent. The existing OPENAI_API_KEY is reused server-side. OPENAI_PACKET_MODEL optionally overrides the existing vision model. Responses use structured output and store:false. Runtime validators reject unknown keys and malformed responses, flag reversed ranges and questionable units, and lower high confidence when supporting OCR evidence is missing. OCR failures use an explicitly labeled image-interpretation fallback with review required.

API routes:
- POST /api/v1/packet-media/prepare: owned mediaId, rotation, percentage crop edges; returns private processed image and originalMediaId.
- POST /api/v1/packet-extractions: consent:true, one to four owned photos with front/back/instructions/barcode side labels, Idempotency-Key; returns an asynchronous job.
- GET /api/v1/packet-extractions/:id: private status/result, OCR, field confidence and supporting evidence.
- POST /api/v1/packet-extractions/:id/confirm: confirmed:true and explicitly reviewed values. Users can clear uncertain values. A completed usable result is required. All detected fields must be represented; numeric ranges, units and barcode digits are checked.
- Existing atomic packet/project creation accepts extractionId only after confirmation, then stores confirmed values, raw extracted values, original photo references and confirmation timestamp. Clients cannot forge these provenance fields.

Packet extraction is limited to one concurrent job and excludes concurrent photo editing/plant diagnosis to protect the pilot service. Default limits are five scans per owner/day and 50 globally/day (PACKET_DAILY_LIMIT). Restarted queued/running jobs fail explicitly; original photos remain available for retry. Client requests are replay-safe. Confirmation is immutable; a new scan is needed for a different confirmation.

Scope boundaries: English OCR only; no product barcode database, QR-link traversal or exact retail SKU matching is connected. Barcode panel text/digits can be read and manually confirmed. Existing GBIF search offers optional species references, not a verified cultivar/product match. Weather, frost dates, growing plans, lifecycle milestones, voice and subscriptions remain later phases. No advice is silently added from model memory during packet extraction.

Validation uses synthetic labeled packet fixtures, malformed images, unsupported units, contradictory ranges, OCR failures, authenticated HTTP roundtrips, cross-account access, consent/confirmation enforcement and original-photo provenance. A 30–50 real-packet benchmark, physical Android/iOS camera/keyboard acceptance, and the final signed APK remain pending. Synthetic fixture success is not a real-packet accuracy certification.
