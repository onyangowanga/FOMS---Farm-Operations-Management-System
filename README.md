# FOMS

Farm Operations Management System — a mobile-first farm operations workspace.

The interface uses a dark forest-green theme (`#173b27`) for desktop/mobile navigation and PWA browser chrome, with high-contrast navigation labels and a light main workspace.

Updated browser/Apple/PWA icons are copied from the supplied favicon assets. Versioned PNG/ICO references prevent stale icons, and the app manifest retains the FOMS identity, start URL and forest-green theme. The unchanged legacy SVG is not selected over the newly supplied raster icons.

## Included in this foundation release

- Username sign-in with short-lived access JWTs, rotating refresh tokens, bcrypt password hashing, and HttpOnly cookies. Public registration is disabled.
- Organization-scoped farms, blocks, crop cycles, livestock, tasks, farm journal entries, and expense records.
- Role-based access for owners, managers, agronomists, and workers.
- Operational dashboard, responsive Vanilla JS interface, installable PWA shell, offline record queue, and audit events.
- Inventory with stock movement history and low-stock thresholds; buyer sales invoices with partial payments and revenue/profit summaries.
- Private farm document uploads for PDFs and photos (PDF, JPEG, PNG, WebP; 10 MB maximum), persisted in a Docker volume.
- PostgreSQL schema managed by Prisma, Tailwind CSS 3, Docker image build.

## Version 0.2 - Farm structure

- Organization hierarchy screen with farms and their blocks / plots; owners can rename the workspace.
- Editable farms and blocks, farm-specific block filters, and complete paginated farm/block selectors.
- Farm and block GPS coordinates, including negative coordinates and browser location capture (HTTPS or localhost required).
- GPS values must be provided as a pair, within latitude -90 to 90 and longitude -180 to 180; editing supports clearing both.
- Crop forms select blocks belonging to the chosen farm. Daily reports select the associated crop or livestock; legacy journal block links are preserved. The API rejects cross-tenant and cross-farm references.
- Blocks retain their original farm. Archives are blocked while active related records remain; archiving does not delete history.

Run `npm test` for validation tests. To include database-backed API tests in a local container stack, set `FOMS_TEST_URL=http://app:3000` and run the tests in the Compose build-stage migration service after the app is healthy. Share the app's upload volume so photo-test cleanup accesses the same files (replace `app_foms-uploads` if using a different local Compose project name):

```sh
docker compose run --rm --no-deps --volume app_foms-uploads:/app/uploads -e FOMS_TEST_URL=http://app:3000 migrate npm test
```

Test workspaces are generated uniquely and removed afterward; never run these tests against production.

## Version 0.4 - Livestock management

- Goats, sheep and poultry support individual animals or batches, with identification, breed, birth/hatch date, age, living quantity and weight per animal.
- Owners/managers can manage profiles and log dated vaccination (including next due date), health, weight and mortality records. Workers retain daily-report access only; agronomists do not access livestock management.
- Poultry also have feed-consumption records in kg and egg-production counts; totals are shown on their detail page. These do not create inventory, expenses or sales automatically.
- Mortality is deducted atomically from living quantity, never below zero. Complete mortality marks the record deceased; dashboard totals count living animals. Events remain append-only and archived profiles retain history.
- Existing groups are migrated as batches when quantity exceeds one; existing deceased records retain their original quantity as initial quantity and become zero living animals. Legacy vaccination dates remain without fabricated history.
- Initial quantity may be corrected before history exists; quantity/farm/species/tracking mode lock once history is recorded. New health, weight and vaccination observations must use activity records; backdated logs do not overwrite newer observed values.
- Lists and clickable profiles use mobile cards; daily-report selectors continue linking to the same livestock IDs.
- Livestock writes require a connection. Browser activity requests carry a reusable UUID so retrying the same save cannot deduct mortality twice.
- API: `GET/POST /livestock`, `GET/PATCH/DELETE /livestock/:id`, `GET/POST /livestock/:id/events`. Lists support `page`/`limit`, and livestock lists also support `farmId`/`species`. Events accept `requestId` for safe retries. Event editing/deletion, acquisitions/transfers, breeding and automatic feed-stock integration are not part of this release.

## Version 0.5 - Task workflow and in-app notifications

- Mobile task lists and linked details support creation/editing, farm/assignee selection, due date/time, priority, status filtering and search. Owners/managers manage tasks; workers access only assigned tasks; agronomists retain read-only task access.
- Tasks follow Pending -> In progress -> Completed -> Approved. Owners/managers approve completed tasks or request rework with a required explanation, returning them to In progress. Approved tasks are final. Profile edits and evidence changes lock on submission; reassignment of an editable task returns it to Pending.
- Evidence is optional by default, with an evidence-required setting per task. Required tasks need at least one active uploaded file before submission; an external legacy URL does not satisfy this requirement.
- Private evidence supports verified JPEG, PNG, WebP and PDF, maximum 10 MB per file and 10 active files per task. Workers can remove only their own files before submission; owners/managers can remove active files on editable tasks. Removal/archive retains stored files and workflow history, but archived/removed evidence is inaccessible.
- Workflow history records creation, profile edits/reassignment, start, evidence changes, submission, approval and rework. Existing task statuses, completion dates and external evidence links are retained without fabricated history.
- Removing a workspace member unassigns their active tasks and records the change in each task's history. Editable tasks return to Pending; submitted/approved statuses and archived historical assignments are preserved.
- A header Inbox provides personal notifications for assignment, submission to workspace owners/managers, approval and rework. It supports unread counts, mark-read/mark-all-read and links to task details. Recipients see only notifications for currently accessible active tasks; reassignment removes the former worker's inbox access to that task. Counts refresh on page rendering and every minute while connected.
- Task/evidence/notification writes require a connection and are not added to the offline queue. Status retries at the same current status do not create duplicate workflow events or notifications.
- API: `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/:id`, `POST /tasks/:id/status`, `GET /tasks/:id/events`, `GET/POST /tasks/:id/evidence`, `GET /tasks/:id/evidence/:evidenceId/download`, `DELETE /tasks/:id/evidence/:evidenceId`, and `GET /notifications`, `PATCH /notifications/:id` with `{ "read": true }`, `POST /notifications/read-all`. Task list filters: `status`, `farmId`, `assignedTo`, `page`, `limit`.
- No email/SMS/WhatsApp delivery, automated reminders, recurring tasks or background scheduler in this release. The per-user database inbox is the notifications foundation.
- The canonical `npm test` runner executes test files sequentially to avoid oversubscribing local Docker resources and expiring Prisma's existing five-second transaction budget. Assertions and production transaction timeouts are unchanged.

## Version 0.6 - Farm journal and incident follow-ups

- Daily operational logs, field observations, work performed, weather, recommendations and pest/disease reports share the existing crop/livestock/general reporting form. Dates default to the current local date/time; private optional photos and existing associations are retained.
- Mobile journal cards link to full details and editing. Filter by farm, subject, report type, incident status, search and inclusive local date range. Workers see/edit/archive only their own reports and retain their simple reporting interface.
- Owners, managers and agronomists assess Low/Medium/High severity and add dated, append-only Open/Resolved incident follow-ups. Recurrences can reopen incidents with an explanatory note. Workers can report incidents and read follow-ups on their own reports, but cannot assess severity or change incident status.
- Follow-ups have reusable request UUIDs; retrying the same save does not duplicate history. Backdated notes are retained without overwriting a newer incident status/severity. Original observation time/subject lock once follow-ups exist; severity changes then use follow-ups. Tracked incidents cannot be converted into ordinary notes.
- Existing incident-category reports or notes containing incident text initialize as Open with unassessed severity, without fabricated follow-ups. Ordinary reports and stored photos remain unchanged. Archives preserve history while removing active access.
- Incident follow-ups and photo submissions require a connection and never enter the offline queue; existing ordinary journal edit/archive offline support remains. Recorded journal costs are observations only and do not automatically create finance records.
- API: `GET /journal/:id` includes follow-up history; `POST /journal/:id/follow-ups` accepts `requestId`, `notes`, `observedAt`, `incidentStatus` and optional `incidentSeverity`. Existing journal CRUD/photo endpoints remain. List filters: `farmId`, `cropId`, `livestockId`, `subjectType`, `category`, `incidentStatus`, `search`, ISO date/time `from`/`to`, `page`/`limit`.

## Version 0.7 - Hybrid inventory

- Quantity batches track seeds, fertilizers, chemicals, feed, vaccines, supplements and ordinary tools. Valuable equipment can instead be tracked individually, with a unique asset ID/SKU, optional serial number, condition and append-only dated maintenance records. Existing items remain batches.
- Linked mobile cards/details replace wide inventory tables. Filter by name/SKU/serial, category, farm, tracking mode and low-stock status. Owners/managers create/edit/archive items and record movements/maintenance; agronomists retain read-only inventory access; workers have no inventory access.
- Receive/issue stock or reconcile an actual physical count with an explanation. Decimal quantities support 3 places and a maximum balance of 1 billion units; costs support 2 places. Existing floating-point stock/reorder quantities are converted to decimals, rounded to 3 places; existing history is retained without invented historical balances.
- Transactions serialize inventory changes, prevent negative balances and include audit events. Browser creation, movements and maintenance saves carry reusable request UUIDs; identical retries do not duplicate entries. Changed retries return a conflict. Inventory writes require a connection and never enter the offline queue.
- Category, tracking mode and unit remain fixed after creation. Archives require zero stock; individual equipment must first be retired. History remains stored. Retirement is permanent, records the reason and removes the equipment from the active quantity.
- Equipment starts Working. Condition/service events record observation date/time, notes, optional cost and next maintenance date. Backdated records remain in history but do not replace newer condition or maintenance dates. Due maintenance is highlighted in list/detail views; no scheduler or external reminder service is introduced.
- Batch stock at or below its reorder level is highlighted and produces personal owner/manager Inbox notifications once per low-stock episode, including initially low new items. Further issues while low do not spam alerts. Receiving stock strictly above the threshold rearms the next alert. Existing items are not assigned fabricated notification history; their next inventory write evaluates their current threshold. Individual equipment never generates consumable reorder alerts.
- Inbox links now support both tasks and inventory. Notifications are recipient/workspace scoped, disappear from active access when an item is archived and are inaccessible after losing owner/manager access. Existing task notification behavior is preserved.
- API: `GET /inventory` supports `category`, `farmId`, `trackingMode`, `search`, `lowStock`; `POST /inventory/items`, `GET/PATCH/DELETE /inventory/items/:id`, `GET/POST /inventory/items/:id/movements`, and `GET/POST /inventory/items/:id/asset-events`. `ADJUSTMENT.quantity` is the actual counted balance, not a delta. Movement history lists newest recorded first; observations cannot predate the item or be future-dated.
- Inventory/maintenance costs do not automatically create expenses, and issuing feed does not automatically update livestock records. Procurement, transfers and automatic finance integrations are not included.

## Version 0.8 - Finance

- Owner/manager Finance screen filters by farm, inclusive local date range and currency, with separate currency summaries for invoiced revenue, approved expenses, pending expenses, profit, payments collected, current outstanding and expense-category breakdowns. No exchange-rate conversion or mixed-currency addition.
- **Profit = invoiced revenue minus owner-approved expenses.** All new expenses await owner approval, including owner-created entries. Pending expenses are visible separately and excluded from profit. Existing approvals are preserved. Approving an expense in an older period updates that period's current summary; this is not a historical approval-date ledger.
- Revenue uses the sale date; expenses use the expense date. Collections use payment receipt date and may include older invoices paid in the selected period. Outstanding is the current remaining balance of invoices sold in the selected period, not a historical closing balance. The dashboard displays the current server-local month in KES only; Finance has inclusive local-date controls for any currency.
- Mobile expense and invoice cards link to full details, editing and payment/receipt history. Pending expenses can be edited/archived; approved expenses and their attachments are locked. Only owners approve, and approval retries are safe. Invoices can be edited/archived before any payment; invoices with payments lock to protect their currency and balances. Archive retains history and excludes active summaries. Refunds, reversals, credit notes and unapproval are not implemented.
- Decimal expense amounts and all monetary inputs support two places, strictly positive and at most 9,999,999,999.99. Existing floating-point expenses migrate to Decimal, rounded to two places. Invoice quantity supports three places, bounded at 1 billion. Invoice total is quantity times unit price rounded once to two places; zero/overflow totals are rejected.
- Invoice/expense creation and payments accept reusable optional request UUIDs; the browser always sends one. Identical retries do not create duplicate buyers/invoices/expenses/payments; changed retries conflict. Serialized transactions include audit events and prevent concurrent overpayment. Payments are append-only and cannot be future-dated.
- Private expense receipts reuse type-verified PDF/JPEG/PNG/WebP uploads (10 MB/file, 10 active files/expense). Owner/manager access only, without public storage metadata. Receipts can be removed before approval; stored files/history are retained and inactive receipt downloads return 404. Add receipts on details before approving.
- Financial reads/writes require a connection; they are not cached/queued as fresh financial data. Legacy queued financial changes are blocked from automatic replay and shown for explicit review/discard on Finance; review current server records before re-recording online.
- API: `GET /finance` supports `farmId`, `currency`, ISO `from`/`to`; `GET/POST /expenses`, `GET/PATCH/DELETE /expenses/:id`, `POST /expenses/:id/approve`, `GET/POST /expenses/:id/attachments`, `GET /expenses/:id/attachments/:fileId/download`, `DELETE /expenses/:id/attachments/:fileId`; existing sales/buyers/payment endpoints plus `GET/PATCH/DELETE /sales/:id`. Expense lists support category/approval/search/farm/currency/date/page/limit; sales lists support search/payment-status/farm/currency/date.
- Workers/agronomists cannot access financial APIs/pages or private receipts. No automated inventory/journal/maintenance-to-expense posting, taxes, payroll, bank reconciliation, PDF/Excel exports or external payment processing in this release; exports remain V0.9.

## Local development

Requirements: Node.js 20+, npm, and PostgreSQL 14+.

1. Install packages: `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` plus a random JWT access secret (at least 32 characters).
3. Create the database, then run `npm run db:generate` and `npm run db:deploy`.
4. Build the stylesheet with `npm run build:css`.
5. Start the app with `npm run dev` and visit `http://localhost:3000`.

Create a trusted platform administrator with `node scripts/create-admin.js` in an interactive terminal, then sign in and create client workspaces from Clients. The health endpoint is `GET /api/v1/health`.

## Containerized testing (recommended)

Requirements: Docker Desktop with Docker Compose.

From this directory, start the complete stack with:

```sh
docker compose up --build
```

Compose starts PostgreSQL, waits for its health check, applies the Prisma migrations, and then starts FOMS. Open `http://localhost:3000`; the API health check is `http://localhost:3000/api/v1/health`. Bootstrap your administrator in a trusted interactive terminal with `docker compose exec app node scripts/create-admin.js`.

The compose defaults are for local testing only. `POSTGRES_PASSWORD` and `JWT_ACCESS_SECRET` can be overridden in a local `.env` file; change both before using the stack beyond a local machine. Set `FOMS_PORT` to change the host port, for example `FOMS_PORT=3001`.

Stop the services with `Ctrl+C`, or run `docker compose down`. The named PostgreSQL volume preserves test records across restarts. To reset the database and delete its records, run `docker compose down --volumes`.

Uploaded farm files are stored in the named `foms-uploads` volume and are served only through authenticated, organization-scoped download routes. For local testing, the app accepts PDF, JPEG, PNG, and WebP files up to 10 MB. Cloud deployments should replace local-volume storage with private object storage and backups.

## Production

Build the Docker image from this directory with `docker build -t foms:0.1.0 .`. Provide the environment variables at runtime and run migrations with a build-stage image before starting application instances: build with `docker build --target build -t foms-migrate .`, then run `docker run --rm --env-file .env foms-migrate npm run db:deploy`. The runtime image listens on port `3000`.

Set `COOKIE_SECURE=true` when the application is served over HTTPS. The current browser app and API are served from the same origin.

### VPS deployment

The deployment script is intended to run on the VPS from a clone of this repository. It fast-forward pulls `main`, creates a mode-600 `.env` containing fresh database/JWT secrets on first run, applies migrations, and updates only the Compose project named `foms-vps`. It does not stop or remove other Compose projects or delete volumes.

```sh
git clone https://github.com/onyangowanga/FOMS---Farm-Operations-Management-System.git /opt/foms
cd /opt/foms
./scripts/deploy-vps.sh
```

The script defaults to binding FOMS to `127.0.0.1:3003`, enables secure cookies, and requires HTTPS termination by a reverse proxy. Configure a hostname and HTTPS proxy on the VPS to forward to `http://127.0.0.1:3003` before using sign-in. Do not expose port 3003 directly to the public internet or disable `COOKIE_SECURE`. Existing deployments retain their `.env` settings: to change the port, update `FOMS_PORT` there and the FOMS reverse-proxy upstream together. For later updates, run `./scripts/deploy-vps.sh` again from the `main` checkout. The persistent database and upload volumes are not removed by the script.

### Live domain and HTTPS

FOMS is served at `https://farmoms.co.ke`, with HTTP redirected to HTTPS. Its isolated Nginx configuration is in [deploy/nginx/farmoms.co.ke.conf](deploy/nginx/farmoms.co.ke.conf), installed on the VPS as `/etc/nginx/sites-available/farmoms.co.ke.conf` and enabled through a matching symlink in `sites-enabled`.

Both `farmoms.co.ke` and `www.farmoms.co.ke` resolve to `185.167.97.200` and are covered by the Let's Encrypt certificate. HTTP requests and HTTPS requests to `www` redirect to `https://farmoms.co.ke`, preserving the path and query string. The certificate uses the webroot `/var/www/foms-acme`; keep the HTTP ACME challenge route accessible for both hostnames for renewal. Certbot schedules automatic renewal and reloads Nginx after renewal.

## API resources

All application endpoints are under `/api/v1`. Authentication endpoints are `/auth/login`, `/auth/password`, `/auth/refresh`, `/auth/logout`, and `/auth/me`; `/auth/register` always returns 403. Authenticated resource routes include `/dashboard`, `/organization`, `/farms`, `/blocks`, `/crops`, `/livestock`, `/tasks`, `/journal`, `/expenses`, `/team`, `/inventory`, `/sales`, and `/documents`. `GET /organization` returns the complete active farm/block hierarchy; owners can rename the workspace with `PATCH /organization`. Farms and blocks support create, edit and archive; `GET /blocks?farmId=<uuid>` filters by farm, and lists support `page` and `limit` (up to 100). Inventory movements use `/inventory/items/:id/movements`; sale payments use `/sales/:id/payments`; document uploads and downloads use `/documents`.

## Version 0.3 - Controlled access and crop management

- Everyone uses the same username/password login. The platform-only `FOMS_ADMIN` role is not advertised on the login page and is never assignable through Team or client onboarding.
- Only FOMS Admin creates a client workspace and its initial owner (`GET/POST /admin/clients`). Owners then set up farms, blocks and users. Platform sessions cannot access client farm APIs.
- Version 0.3.1 adds client workspace / owner-profile editing and one-time owner password resets in Clients. Resetting revokes existing sessions and disables the previous password. The generated temporary password expires after 24 hours, can sign in once, and opens only the mandatory new-password screen. No farm API or refresh session is available until the password is changed; abandoning that screen requires a new admin reset. Neither the old nor the temporary password can be selected as the new password. Share the temporary password securely; it is returned once, stored only as a hash, and never included in audit details.
- Crop cycles now have editable yielding days, measured from actual transplant if recorded, otherwise field planting / planned transplant. Crop-type maturity days initialize this value. Suggested transplant and harvest dates update while they remain automatically filled; manually entered dates are preserved and current suggestions remain visible. Clearing a date enables automatic suggestions again. Crops without yielding days can still use a manually selected harvest date.
- Activities support Custom / specify and Other / specify units. Quantities remain positive and fertilizer products remain required. Harvest totals group by the actual unit label without conversions.
- Daily reports replace the generic journal-entry form. The observation date/time defaults to now in the device's local timezone and is stored as a timestamp. Select general farm, crop or livestock, then a farm and associated record. Photos are optional with prominent camera/upload controls, private JPEG/PNG/WebP storage and a 10 MB limit. Report submissions require a live connection (including text-only submissions) and are not queued as successful uploads offline. Existing journal data remains readable, including historical block links.
- Workers see only Dashboard, assigned Tasks, their own Daily reports and Account. The API enforces the same restrictions, with minimal farm/crop/livestock report selectors, own-report/photo access, and assigned-task status changes only. Owners, managers and agronomists can review workspace reports; Team is owner/manager only. Worker dashboards do not disclose workspace financials, inventory, crop details or other workers' tasks. Role-separated offline caches prevent previously cached manager lists from being shown after a role change.
- On mobile, record tables become labeled stacked records, including tables rendered after actions or in dialogs. Desktop tables retain their columns.
- Usernames are globally unique, case-insensitive, 3-80 characters, using letters, digits, dots, underscores and hyphens. The migration uses unique email prefixes where possible and a UUID suffix for collisions/short prefixes. Existing passwords remain valid; email is contact information, not a login identifier.
- New/changed passwords require 8-72 characters, at least one letter, number and special character, and no more than 72 UTF-8 bytes. Account allows password changes after verifying the current password; all sessions are revoked.
- Owner/manager user management covers all farms in their workspace. Managers cannot manage owners. The last owner cannot be demoted/removed, and users cannot remove their own access. Removing membership preserves historical records and clears task assignments. Editing access/profile revokes sessions. No cross-workspace member operations are permitted.
- Dashboard metrics use two compact columns on mobile and link to their source pages. Crop progress remains full-width on mobile, with links to each crop.
- Crop types store nursery duration and field maturity defaults. Cycles support nursery sowing, planned field planting/transplant, actual transplant and expected harvest dates. Nursery crops need a sowing date and duration; the form suggests transplant/harvest dates but permits adjustments.
- Open a crop to edit details, change its observed stage with a reason and timestamp, or record irrigation, fertilizer applications and harvests. Stage history is retained; corrections are explicit and dates never automatically advance stages. Stages: planned, nursery, transplanted, growing, flowering, fruiting, ready to harvest, harvested, cancelled.
- Activities retain quantities and units; fertilizer requires a product name. Harvest totals are grouped by unit without unsafe conversions, and do not automatically create inventory movements or sales. Crop archives retain lifecycle/activity history.
- Crop APIs: `/crops/types` (list/create), `/crops/types/:id` (edit), `/crops/:id` (read/edit/archive), `/crops/:id/stages` and `/crops/:id/activities` (create records). Lifecycle updates must use the stages endpoint, not a generic crop patch.

### V0.3 rollout

Back up the database and uploads before deploying. The additive migration preserves users, farm data and crop stages. Before switching users to the release, extract the migrated usernames in a trusted server terminal or from Team/Admin, and share them securely. Do not expose password hashes.

Bootstrap the developer account on the VPS with `docker compose --project-name foms-vps exec app node scripts/create-admin.js` from `/opt/foms` after migration. This prompts for a new, unique username/contact email and a hidden password; it never promotes a client owner or accepts credentials through a public API. Use the normal login page afterward.

Alternatively, use the same trusted command with `--setup-link --url=https://farmoms.co.ke` to create a new administrator with a one-time password setup link. Non-interactive trusted provisioning may additionally supply `--name=... --username=... --email=...`; no password is accepted in command arguments. The random 256-bit token is stored only as a SHA-256 hash, expires after 24 hours and is consumed atomically. The link carries the token in its URL fragment rather than server request URLs. Keep it private; it grants the ability to set that admin's initial password. This does not enable public account registration.
