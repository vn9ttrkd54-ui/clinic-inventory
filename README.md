# Clinic Inventory

A small staff website for tracking clinic supplies, estimating daily use, highlighting low stock, and reopening saved supplier links. The online version uses Vercel and Supabase. The original local version is also available.

## Online staff access

Staff sign in with individual email/password accounts. A clinic administrator approves each address in **Staff access**, creates a one-time setup link, and shares it directly with that person. Each person chooses their own password. The same process creates a password reset link. This website does not send account emails.

Approval is checked on every data request. Administrators can remove access immediately. The last active administrator cannot be removed through the app. Neither a public source repository nor possession of the website URL provides access to inventory.

The real inventory and sample inventory are separate. Online samples also require staff sign-in. The online clinic workspace starts empty; local SQLite files are not automatically uploaded.

## Workflow

Everything starts on one dashboard.

1. **Add supply** saves its unit, starting physical count, reminder level, and optional storage or packaging information.
2. **Suppliers** opens the saved websites for that supply. Low-stock status opens the same list.
3. **Today's usage** saves a daily patient total and estimates consumption using each item's staff-defined rate.
4. **Log item usage** saves exact amounts. Exact use replaces the estimate for that item and date, including a zero-use entry.
5. **Update stock** adds received supplies or replaces stock with a physical shelf count.

Low stock appears first with a red quantity and a text label. Supplies and supplier links can be archived and restored. Recent changes, refresh, and CSV export are available on the dashboard. Stock reminders appear in the app; no email, SMS, ordering, or automatic price comparison is performed.

Only daily patient totals are used. Do not enter patient names, medical information, or other identifying patient details in supply fields.

## Counts and estimates

Quantities, reminder levels, and usage share the chosen tracking unit. Two pairs of gloves means four individual gloves. Packaging information is descriptive, not an automatic conversion.

Saving or correcting an existing day updates it without deducting use twice. Changing a usage rate preserves previously saved estimates. A physical count includes all deliveries already entered and use through the selected daily cutoff; later deliveries are added and later days' usage is subtracted. Estimates can drift, so reconcile against physical counts regularly.

## Run locally

Requires Node.js **24.x**.

```sh
npm ci --ignore-scripts
npm run dev
```

Open `http://localhost:3001/` for local clinic inventory, or `http://localhost:3001/?demo=1` for samples. Use `PORT=3002 npm run dev` for a different port. The local server is loopback-only and has no staff accounts. Local records persist in separate SQLite files under `data/`. Stop the server before copying that directory as a backup.

## Online deployment

The source includes a pinned dependency lockfile, Vercel configuration, Supabase migration, and account-setup Edge Function.

1. Create a separate Supabase project and apply `supabase/migrations/20261101184627_clinic_cloud_storage.sql`.
2. Privately initialize `clinic_private.settings` with the SHA-256 hash of a random server secret, approve the first administrator in `clinic_private.staff`, and initialize clinic/demo documents with snapshots from `createStore().exportSnapshot()` and `seedDemo()`. Keep these operational values out of source control.
3. Deploy `supabase/functions/staff-setup`. It authenticates with the server secret before using Supabase's server-side account-management credentials; its gateway JWT check is disabled because it implements this authentication itself.
4. Configure Vercel production variables: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and sensitive `CLINIC_API_SECRET`. Use the same secret whose hash was saved in Supabase. Only the URL and publishable key are bundled into browser assets.
5. Build with `npm run build`; publish `dist/` and the `api/` function on Node 24. Keep the normal production domain accessible so staff can reach the app's own login. Protect previews and keep production credentials out of preview builds.
6. Generate the first administrator's one-time setup link through the protected account-setup function. After setup, administrators can manage additional staff entirely in the website.

For a local cloud build, put these variables in ignored `.env.local`, then run `node --env-file=.env.local scripts/build-cloud.mjs`. Keep this file private. Preview deployments need their own isolated configuration to build.

Inventory is stored in Supabase Postgres as versioned JSON snapshots. A Vercel request restores a temporary in-memory store, validates changes through the existing inventory rules, and atomically saves a new version. Conflicting updates retry against current records. No persistent data relies on Vercel's temporary filesystem. The server audit records the staff actor for successful updates.

The CSV export is an inventory summary, not a full database backup. Project owners should arrange regular full database exports and verify restoration; no automated backup-and-restore job is included here.

## Checks and source

```sh
npm test
```

The suite covers stock calculations, persistence, snapshot round trips, concurrent-update retries, rejected changes, request guards, and private local file permissions. With the local server running, `npm run security:check` checks its HTTP protections without altering inventory.

- `inventory.mjs`: validated inventory behavior and snapshot serialization.
- `server.mjs`, `security.mjs`: local HTTP server and protections.
- `api/index.mjs`, `cloud/service.mjs`: authenticated online API and atomic persistence.
- `cloud/client.mjs`, `public/`: staff login, administrator controls, dashboard.
- `supabase/`: private database schema and account setup function.
- `scripts/build-cloud.mjs`: public asset build.

See [SECURITY.md](SECURITY.md) for access controls and verification scope. Environment files, local databases, dependencies, generated assets, and provider credentials are excluded from source control.
