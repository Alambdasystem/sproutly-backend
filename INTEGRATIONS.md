# Remaining production integrations

## Email verification and recovery

Implemented: hashed, purpose-bound, expiring, single-use tokens; email verification; password reset with existing-session revocation; per-account mail cooldown; generic reset responses; HTTPS fragment links removed from the browser address bar after reading. Raw tokens are not returned by the API or stored in the database. Backend tests inject a mail transport and never use production email credentials.

To activate: configure `RESEND_API_KEY`, verified `MAIL_FROM`, and `PUBLIC_APP_URL=https://sproutly-frontend.onrender.com` through Render's secret configuration. Use a verified sender under the owner's control. No sender account is configured yet. Provider acceptance is not inbox delivery; verify inbox placement with an owner-controlled mailbox before marking this complete.

The existing Workmates relay is deliberately not repurposed: its invitation-only URL policy does not permit Sproutly recovery links.

## Off-site backups

Implemented: private S3 bucket enforcement, expected account ownership, server-side encryption, native SQLite snapshot upload plus checksum manifest, independent download and database verification. Local snapshots survive upload failures. `/health` reports off-site enabled/success/failure timestamps separately.

To activate: provide an owner-approved private bucket, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCOUNT_ID` (12 digits), `AWS_REGION`, and an AWS credential provider usable by the Render service. A least-privilege principal needs bucket `s3:GetBucketPublicAccessBlock` and object `s3:PutObject`, `s3:GetObject` under `sproutly/backups/*`. Block all four public-access settings. Configure a lifecycle retention policy deliberately; the application does not delete remote snapshots. Storage charges and account ownership must be established before creating resources.

No off-site destination or runtime credentials are configured. Mock transport tests prove behavior, not real off-site delivery or disaster recovery. Full production recovery still requires a real remote download and restore rehearsal.

## Payments and sellers

Implemented: isolated Stripe sandbox Checkout API, server-derived prices, stable idempotency, raw-body webhook signature verification, trusted session retrieval, exact currency/amount checks, replay protection. Browser redirects do not settle payments. A `sk_live_` key is explicitly rejected: current catalog and providers are sample records isolated per garden. Charging for them would not create a real seller order.

To exercise the sandbox, configure `STRIPE_SECRET_KEY` with a test key, `STRIPE_WEBHOOK_SECRET`, and `PUBLIC_APP_URL`. Endpoint: `POST /api/v1/payments/checkout` with authenticated registered account, `items`, and `Idempotency-Key`. Webhook: `POST /api/v1/payments/webhook`. Nothing is charged with current configuration.

Production still needs Stripe connection, legal merchant/seller onboarding, shared seller-owned inventory, reservations and expiry, taxes/shipping rules, refund handling and Connect payout onboarding. Existing real merchant catalog offers continue checking out on the merchant's own site. No claim is made that payouts or live marketplace transactions are complete.
