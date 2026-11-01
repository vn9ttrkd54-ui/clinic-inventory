# Clinic Inventory

A browser-based tool for tracking clinic supplies, highlighting low stock, and reopening saved supplier websites. The current version runs locally and saves records on the computer running the server.

## Run

Requires **Node.js 22.13 or newer** (tested with Node 24). No package installation is needed.

```sh
npm run dev
```

- Sample inventory: **http://localhost:3001/?demo=1**
- Your real inventory: **http://localhost:3001/**

The two workspaces use separate databases. Sample counts, usage rates, and supplier names are illustrative; they are not clinic records or clinical recommendations.

Stop with Ctrl+C. To use a different port, run `PORT=3002 npm run dev`.

## Workflow

Everything starts on one dashboard; there are no page tabs.

1. **Add supply** saves an item, its unit, a physical starting count, and its reminder level. Storage and packaging are optional settings.
2. **Suppliers** on each card opens that item's saved company websites or product links. Links open in a new tab. The stock status also opens this list.
3. **Today's usage** lets staff enter and save a patient total directly on the dashboard. It updates supplies configured with a staff-defined per-patient rate and preserves any exact usage already recorded.
4. **Log item usage** opens a form for exact amounts used or a different date. Exact usage replaces the patient estimate for that item and day.
5. **Update stock** offers two choices: add received supplies, or replace stock with a physical shelf count.

Low stock appears first, with red quantities and a “Low stock” or “Out of stock” label. The pencil on a card edits its settings. Recent changes are collapsed at the bottom; refresh and CSV export are in the footer.

Only a daily patient total is needed; the app has no patient-name or medical-record fields.

## Counts and estimates

- Quantities and thresholds use the same tracking unit. If tracking individual gloves, two pairs means four gloves. The units-per-pack field is descriptive; entering 10 gloves does not mean 10 boxes.
- A patient estimate is saved for each item and date. An actual-use entry replaces the estimate for that item/day, including when actual use is zero.
- Saving an existing day updates its record rather than subtracting it a second time.
- Changing a per-patient rate does not rewrite already saved days. Newly saved dates use the new rate.
- Physical counts use a **daily cutoff**. Choose yesterday for a start-of-day count, or today for an end-of-day count. Logged use through that date is already included; subsequent dates are subtracted. The app is designed for daily reconciliation, not intraday prediction.
- A physical count includes all deliveries already logged at that point. Later deliveries are added.
- Calculated shortages display zero stock plus an explicit shortfall message in the item detail. Periodic physical checks remain necessary because estimates and incomplete usage logs can drift.
- Reminders are visible in the inventory screen. The app does not send email, SMS, or push notifications.

## Persistence and access

Inventory, saved links, daily entries, and recent activity are stored in SQLite files under `data/` on this computer. They survive browser refreshes and server restarts. Close the server before copying this directory as a backup.

The current version runs on localhost, without staff accounts or remote access. A shared online deployment would need staff access control and managed backups.

The server restricts its data directory and SQLite files to the operating-system account running it. Cross-site browser API requests are refused. These protections do not replace staff authentication. See [SECURITY.md](SECURITY.md) for the reviewed scope and the approved-email access plan.

Archived supplies and supplier links can be restored. Use the Archived supplies filter to find archived items. The footer exports the current inventory as CSV.

## Files

- `inventory.mjs`: validated inventory records, saved supplier links, and stock calculations.
- `server.mjs`: local HTTP server and API.
- `security.mjs`: local request protections, JSON parsing, security headers, and private file permissions.
- `public/`: accessible HTML, CSS, and JavaScript interface.
- `test/inventory.test.mjs`: business-logic and persistence checks.

Run the checks with `npm test`.

With the local server running, `npm run security:check` verifies the HTTP protections without changing either inventory. This command only targets the local loopback server.

## Verification completed

Nineteen business-logic, persistence, and security checks passed. Eighteen additional HTTP security checks passed against the running local server, with both inventories unchanged. Browser checks of the simplified dashboard covered adding a supply and supplier link, patient estimates, preserving exact-use overrides when saving a patient total, deliveries, physical counts, editing reminder levels, archiving/restoring, and search. Checks used the separate sample workspace.

The dashboard, supplier dialog, stock-update dialog, and daily-usage dialog were checked at a 320px phone width without horizontal overflow. The desktop dashboard was checked at 1280px. Dialog Escape behavior returns focus to the supply card, and saving the quick patient total returns focus to its save button. Browser checks reported no JavaScript errors.
