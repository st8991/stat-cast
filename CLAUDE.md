# Notes for coding agents

## Neon (production warehouse)

- The warehouse is Neon Postgres: project `steep-frost-33796990`, default branch `production` (Postgres 18, database `neondb`, `aws-us-east-2`). `neon.ts` at the repo root is the project policy; don't rewrite it.
- Neon agent skills live in `.claude/skills/` (`neon`, `neon-postgres`), pinned in `skills-lock.json`. Refresh them with `npx neon@latest skills update`.
- Connection strings come from `neon env pull` into `.env.local` (gitignored): `DATABASE_URL` is pooled (web app), `DATABASE_URL_UNPOOLED` is direct (loader, dbt, migrations). Never print, log, or commit them.
- Pull requests get their own Neon branch, `preview/pr-<number>`, from `.github/workflows/neon-preview.yml`. Test schema or data changes there, not on `production`.
- Cloud sessions have no raw Postgres TCP egress to Neon. Use the Neon API, the Neon MCP connector, or `@neondatabase/serverless` over HTTPS (with `NODE_USE_ENV_PROXY=1`).
- The deployed web app reads Neon through Cloudflare Hyperdrive (`web/wrangler.jsonc`), with `node-postgres`.
