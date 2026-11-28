# stat-cast web

The dashboard as a Next.js + TypeScript app: React UI plus API routes that query
the dbt marts. It runs on Cloudflare Workers through
[OpenNext](https://opennext.js.org/cloudflare) and reaches Postgres through
[Hyperdrive](https://developers.cloudflare.com/hyperdrive/). The data side
(Airflow, the Python loader, dbt, the Databricks lakehouse) is unchanged.

```
Savant ─▶ Airflow + Python loader ─▶ Neon Postgres ◀─ Hyperdrive ◀─ Worker (Next.js)
                 dbt build ───────────▲                                 ├─ /            React dashboard
                                                                        └─ /api/*.json  overview, pitcher, health
```

| Path | What it is |
|---|---|
| `app/page.tsx`, `components/` | The dashboard UI (client components, SVG charts, no chart library) |
| `app/api/overview.json`, `app/api/pitcher/[file]`, `app/api/health.json` | Read-only JSON routes, same paths and payloads as the old FastAPI app |
| `lib/queries.ts` | All SQL: the marts, `raw.ingestion_log` and Airflow's `dag_run` / `task_instance` |
| `lib/db.ts` | Connections: Hyperdrive bindings on Cloudflare, `DATABASE_URL` (Neon's pooled URL) or `WAREHOUSE_*` elsewhere |
| `wrangler.jsonc`, `open-next.config.ts` | Worker config and the OpenNext adapter |

## Local development

Start the stack and load the sample week from the repo root (`docker compose up -d --build && make backfill`), then:

```bash
cd web
npm install
npm run dev                  # http://localhost:3000, reads WAREHOUSE_* (defaults: statcast@localhost:5432)
AIRFLOW_DATABASE_URL=postgres://airflow:airflow@localhost:5432/airflow npm run dev   # with the DAG run grid
npm test                     # unit tests; warehouse tests run when the marts are reachable
npm run preview              # the real Workers build in workerd, Hyperdrive pointed at localConnectionString
```

Docker Compose also serves the app at http://localhost:3000 (`web` service).

## Deploying to Cloudflare

The warehouse is the Neon project linked in the repo root (`neon.ts`, `.neon`; project `steep-frost-33796990`, branch `production`). One-time setup:

1. **Neon env.** In the repo root: `npm i -g neon@latest`, `neon login`, then `neon env pull` (or `neon deploy`, which applies `neon.ts` and pulls). It writes `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) to `.env.local`, or to `.env` if one exists. Both files are gitignored.
2. **Load it.** With those variables present, the pipeline writes to Neon instead of the Postgres container. The loader and dbt use the direct URL, and Compose passes the files into the Airflow and web containers. Run `docker compose up -d --build`, then `make backfill` (sample week) or unpause the DAG. Outside Docker: `set -a; . ./.env.local; set +a`, then the usual `python -m statcast_pipeline ...` and `make dbt`. `npm run dev` in `web/` also reads the root `.env.local`, so local dev hits Neon through the pooled URL.
3. **A read-only role** for the site (recommended): in the Neon console's SQL editor, as the owner role dbt uses,
   ```sql
   create role statcast_web login password '...';
   grant usage on schema raw, marts to statcast_web;
   grant select on all tables in schema raw, marts to statcast_web;
   alter default privileges in schema raw, marts grant select on tables to statcast_web;
   ```
   dbt rebuilds tables, so the default privileges matter. Skip this step to point Hyperdrive at the owner URL instead.
4. **Hyperdrive.** `npx wrangler login`, then create the config from the **direct** URL (Hyperdrive does the pooling, so not the `-pooler` host). Leave off the query string: Hyperdrive always connects over TLS.
   ```bash
   set -a; . ../.env.local; set +a
   npx wrangler hyperdrive create stat-cast-warehouse --connection-string="${DATABASE_URL_UNPOOLED%%\?*}"
   ```
   (With the read-only role, use `postgres://statcast_web:<password>@<direct host>/neondb` instead.) Paste the printed id into `wrangler.jsonc` (`hyperdrive[0].id`).
5. **Deploy.** `npm run deploy` (or `make deploy` from the root). The site goes to `https://stat-cast.<your-subdomain>.workers.dev`; add a custom domain in the dashboard if you want one.

### Workers Builds (how production deploys)

The site is deployed by Cloudflare Workers Builds from this repo and served at **https://statcast.tuckers.solutions** (`routes` in `wrangler.jsonc`; the zone `tuckers.solutions` is on the same Cloudflare account). Hyperdrive config `stat-cast` (`0ed507c6291344b0a256c380caf801dc`) fronts the Neon database. Workers Builds settings:

| Setting | Value |
|---|---|
| Worker name | `stat-cast` (must match `name` in `wrangler.jsonc`) |
| Production branch | `main` |
| Root directory | `web` |
| Build command | `npm run cf:build` |
| Deploy command | `npx opennextjs-cloudflare deploy` |
| Non-production branch deploy command | `npx wrangler versions upload` (preview URLs per branch) |
| Build variables | `NODE_VERSION` = `22` |

No secrets are needed at build time: the database credentials live in the Hyperdrive config, and Workers Builds supplies its own API token for the deploy. Every push to `main` that touches the repo redeploys.

The `deploy web` GitHub workflow is an alternative path for deploying from Actions. It stays idle until `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets exist, so leave those unset while Workers Builds does the deploys.

### The pipeline panel on Cloudflare

DAG runs come from Airflow's metadata database. If that database is reachable from the internet, create a second Hyperdrive config for it and uncomment the `AIRFLOW_HYPERDRIVE` binding in `wrangler.jsonc`. Without it the panel shows "Warehouse only": freshness, landed rows per day and table counts all still come from the warehouse.

### Notes

- Hyperdrive caches read queries for up to 60 seconds by default, so a just-finished load can take a minute to show. Turn caching off on the Hyperdrive config (`--caching-disabled`) if that matters.
- Neon scales to zero when idle, so the first request after a quiet spell can take a second or two while the compute wakes.
- Each request opens up to 5 connections through Hyperdrive and runs the overview's queries in parallel; Hyperdrive keeps the pool to Postgres warm.
