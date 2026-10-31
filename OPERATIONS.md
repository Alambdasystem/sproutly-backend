# Sproutly persistent pilot storage — prepared, not activated

Current live backend: free Render service `sproutly-backend` in Jim's workspace. Its filesystem is ephemeral. Do not deploy this storage change until the disk and data cutover are approved and ready.

## Proposed pilot layout

- Existing service: paid `0.5c-512mb` compute, one instance.
- Persistent disk: 1 GB mounted at `/var/data` (only mounted paths persist).
- Database: `/var/data/sproutly.sqlite`.
- Photos remain private authenticated records inside SQLite, so every native database backup includes them. This is a small-pilot design, not a separate object store. A larger deployment should move to managed Postgres and private object storage.
- Native SQLite online backups: `/var/data/backups`, every 24 hours while the service runs, retaining the latest seven snapshots. Startup also creates a new verified snapshot.
- Full snapshots duplicate the database and photos. A 1 GB pilot disk is deliberately small: seven retained copies plus the live database and restore probe leave roughly 100 MB for active data, often only a few dozen large photos. Monitor disk space and increase capacity before regular photo use. The backup routine checks free headroom and retains existing good snapshots when space is insufficient.
- Each snapshot has a SHA-256 manifest, SQLite integrity and record-count checks, and an independently reopened restore probe. Checksums detect corruption; they are not a signature against malicious modification.
- Disk encryption is provided by Render. Backup files remain private (`0600`, directory `0700`) and are never exposed by the HTTP API. Local snapshots share the disk's failure domain; independent off-site export is still an operations requirement.

## Activation settings

Set only after the persistent disk exists:

```
PERSISTENT_DATA_DIR=/var/data
REQUIRE_PERSISTENT_STORAGE=true
DATABASE_PATH=/var/data/sproutly.sqlite
BACKUP_ENABLED=true
BACKUP_DIR=/var/data/backups
BACKUP_INTERVAL_HOURS=24
BACKUP_KEEP=7
```

Keep existing OpenAI and CORS variables unchanged. The app refuses startup if the required mount is absent or a data path escapes it. `/health` reports storage mode and backup/restore verification timestamps, without file paths or private content. Configure the service's health path to `/health` when activating.

## Cutover and preserving existing data

1. Obtain approval for paid compute, disk charges, the short deployment interruption, and any permitted demo reset.
2. Inspect/export current ephemeral data before a restart if possible. Free Render services do not support shell/SSH, and the current deployed API has no whole-service export. Do not promise the current temporary gardens can be recovered after an instance replacement. Stop for a preservation decision if non-demo records must be retained.
3. Upgrade the existing service and attach the disk through Render. Both steps can deploy/restart the service. Attaching a disk disables zero-downtime deployments and horizontal scaling.
4. For a preserved SQLite source, run a database-native backup and verify it. Restore into a NEW persistent path using the command below; never copy an active SQLite file without its transactional state. If a demo reset was approved, initialize fresh demo gardens instead.
5. Apply the activation settings above, deploy the tested commit, and verify `/health` reports `persistent` and a successful backup with restore verification.
6. Create a disposable test account, plant, journal, and photo. Restart/redeploy once and verify the same records, photo, sign-in, and account isolation. This live persistence acceptance is not complete until performed.
7. Export a verified backup off the service via authorized SCP (`scp -s`) or another approved private destination. Do not log account data or expose snapshots through public routes.

## Backup and restore commands

Run in the backend repository with Node 24:

```
node backup.mjs create /var/data/sproutly.sqlite /var/data/backups
node backup.mjs verify /var/data/backups/SNAPSHOT.sqlite
node backup.mjs restore /var/data/backups/SNAPSHOT.sqlite /var/data/recovered.sqlite
```

The `.json` manifest must travel with its snapshot. Restore refuses to overwrite an existing database or its WAL/SHM files. Stop writes, validate the recovered file, and intentionally point `DATABASE_PATH` at it before restart. Do not use a raw disk-snapshot restore to recover an active SQLite database. Do not restore a production database merely to test recovery; use a disposable destination.

## Device acceptance still open

No connected physical Android/iPhone or ADB is available in this workspace. The following are NOT certified by desktop browser simulation:

- Android Chrome and iOS Safari: real camera capture, rotation, cancel, denied permission and upload fallback.
- Photos & context at narrow width with the actual keyboard open/closed: each field reachable, Analyze & continue and Back tappable, bottom safe area respected.
- Keep an existing photo and all entered context after cancellation, keyboard changes, and Back/Continue.
- A real photo completes Step 3, saves to the correct journal, and remains accessible after the approved persistence cutover/redeploy.
- Screen-reader/keyboard navigation, 200% text zoom, offline upload and slow analysis recovery.

Browser checks already passed at narrow widths and a reduced-height viewport, with separate controls for full-height restoration. Picker unit tests cover upload/camera routing, permission denial, cancellation and invalid files. These checks do not replace physical-device acceptance.
