# FOMS

Farm Operations Management System — a mobile-first farm operations workspace.

## Included in this foundation release

- Organization workspace registration and sign-in with short-lived access JWTs, rotating refresh tokens, bcrypt password hashing, and HttpOnly cookies.
- Organization-scoped farms, blocks, crop cycles, livestock, tasks, farm journal entries, and expense records.
- Role-based access for owners, managers, agronomists, and workers.
- Operational dashboard, responsive Vanilla JS interface, installable PWA shell, offline record queue, and audit events.
- Inventory with stock movement history and low-stock thresholds; buyer sales invoices with partial payments and revenue/profit summaries.
- Private farm document uploads for PDFs and photos (PDF, JPEG, PNG, WebP; 10 MB maximum), persisted in a Docker volume.
- PostgreSQL schema managed by Prisma, Tailwind CSS 3, Docker image build.

## Local development

Requirements: Node.js 20+, npm, and PostgreSQL 14+.

1. Install packages: `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` plus a random JWT access secret (at least 32 characters).
3. Create the database, then run `npm run db:generate` and `npm run db:deploy`.
4. Build the stylesheet with `npm run build:css`.
5. Start the app with `npm run dev` and visit `http://localhost:3000`.

The first person to register creates an organization and becomes its owner. The health endpoint is `GET /api/v1/health`.

## Containerized testing (recommended)

Requirements: Docker Desktop with Docker Compose.

From this directory, start the complete stack with:

```sh
docker compose up --build
```

Compose starts PostgreSQL, waits for its health check, applies the Prisma migrations, and then starts FOMS. Open `http://localhost:3000`; the API health check is `http://localhost:3000/api/v1/health`. The first registration creates the owner account and farm workspace.

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

The script binds FOMS to `127.0.0.1:3001`, enables secure cookies, and requires HTTPS termination by a reverse proxy. Configure a hostname and HTTPS proxy on the VPS to forward to `http://127.0.0.1:3001` before using sign-in. Do not expose port 3001 directly to the public internet or disable `COOKIE_SECURE`. For later updates, run `./scripts/deploy-vps.sh` again from the `main` checkout. The persistent database and upload volumes are not removed by the script.

## API resources

All application endpoints are under `/api/v1`. Authentication endpoints are `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, and `/auth/me`. Authenticated resource routes include `/dashboard`, `/farms`, `/blocks`, `/crops`, `/livestock`, `/tasks`, `/journal`, `/expenses`, `/team`, `/inventory`, `/sales`, and `/documents`. Inventory movements use `/inventory/items/:id/movements`; sale payments use `/sales/:id/payments`; document uploads and downloads use `/documents`.
