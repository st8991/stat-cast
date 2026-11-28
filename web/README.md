# stat-cast web

The dashboard as a Next.js + TypeScript app: React UI plus API routes that query
the dbt marts. It runs on Cloudflare Workers through
[OpenNext](https://opennext.js.org/cloudflare) and reaches Postgres through
[Hyperdrive](https://developers.cloudflare.com/hyperdrive/). The data side
(Airflow, the Python loader, dbt, the Databricks lakehouse) is unchanged.

```
Savant ─▶ Airflow + Python loader ─▶ managed Postgres ◀─ Hyperdrive ◀─ Worker (Next.js)
                 dbt build ───────────▲                                 ├─ /            React dashboard
                                                                        └─ /api/*.json  overview, pitcher, health
```

| Path | What it is |
|---|---|
| `app/page.tsx`, `components/` | The dashboard UI (client components, SVG charts, no chart library) |
| `app/api/overview.json`, `app/api/pitcher/[file]`, `app/api/health.json` | Read-only JSON routes, same paths and payloads as the old FastAPI app |
| `lib/queries.ts` | All SQL: the marts, `raw.ingestion_log` and Airflow's `dag_run` / `task_instance` |
| `lib/db.ts` | Connections: Hyperdrive bindings on Cloudflare, `DATABASE_URL` or `WAREHOUSE_*` elsewhere |
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

One-time setup:

1. **Managed Postgres.** Create a database on a managed host (Neon's free tier works; Supabase or RDS too) and point the pipeline at it in the repo's `.env`:
   ```
   WAREHOUSE_HOST=ep-xxx.us-east-2.aws.neon.tech
   WAREHOUSE_DB=statcast
   WAREHOUSE_USER=statcast
   WAREHOUSE_PASSWORD=...
   WAREHOUSE_SSLMODE=require
   ```
   Then `docker compose up -d` and run the DAG (or `make backfill`). Airflow, the loader and dbt write there instead of the local container.
2. **A read-only role** for the site (recommended):
   ```sql
   create role statcast_web login password '...';
   grant usage on schema raw, marts to statcast_web;
   grant select on all tables in schema raw, marts to statcast_web;
   alter default privileges in schema raw, marts grant select on tables to statcast_web;
   ```
   dbt rebuilds tables, so the default privileges matter. Run the `alter default privileges` as the role dbt connects as.
3. **Hyperdrive.** `npx wrangler login`, then:
   ```bash
   npx wrangler hyperdrive create stat-cast-warehouse \
     --connection-string="postgres://statcast_web:...@ep-xxx.neon.tech:5432/statcast?sslmode=require"
   ```
   Paste the printed id into `wrangler.jsonc` (`hyperdrive[0].id`). Use Neon's direct host, not the `-pooler` one; Hyperdrive does the pooling.
4. **Deploy.** `npm run deploy` (or `make deploy` from the root). The site goes to `https://stat-cast.<your-subdomain>.workers.dev`; add a custom domain in the dashboard if you want one.

To deploy from GitHub on every push to main, add repository secrets `CLOUDFLARE_API_TOKEN` (an API token with *Workers Scripts: Edit*) and `CLOUDFLARE_ACCOUNT_ID`. The `deploy web` workflow skips until both exist.

### The pipeline panel on Cloudflare

DAG runs come from Airflow's metadata database. If that database is reachable from the internet, create a second Hyperdrive config for it and uncomment the `AIRFLOW_HYPERDRIVE` binding in `wrangler.jsonc`. Without it the panel shows "Warehouse only": freshness, landed rows per day and table counts all still come from the warehouse.

### Notes

- Hyperdrive caches read queries for up to 60 seconds by default, so a just-finished load can take a minute to show. Turn caching off on the Hyperdrive config (`--caching-disabled`) if that matters.
- Each request opens up to 5 connections through Hyperdrive and runs the overview's queries in parallel; Hyperdrive keeps the pool to Postgres warm.
