// Postgres connections for the API routes.
//
// On Cloudflare the warehouse is reached through Hyperdrive (binding HYPERDRIVE),
// which pools connections near the database and hands the Worker a connection
// string. Anywhere else (`next dev`, `next start`, tests) it falls back to
// DATABASE_URL, or to the same WAREHOUSE_* settings the Python loader uses.
//
// The Airflow metadata database is optional: binding AIRFLOW_HYPERDRIVE on
// Cloudflare, AIRFLOW_DATABASE_URL elsewhere. Without it the pipeline panel
// shows the warehouse side only.

import postgres from "postgres";

type Sql = postgres.Sql<Record<string, never>>;

interface HyperdriveLike {
  connectionString: string;
}

interface Bindings {
  HYPERDRIVE?: HyperdriveLike;
  AIRFLOW_HYPERDRIVE?: HyperdriveLike;
}

async function cloudflareEnv(): Promise<{ env: Bindings; waitUntil?: (p: Promise<unknown>) => void } | null> {
  // Only resolvable inside the Workers runtime; in Node there is no context.
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = getCloudflareContext();
    return { env: ctx.env as Bindings, waitUntil: (p) => ctx.ctx.waitUntil(p) };
  } catch {
    return null;
  }
}

export function warehouseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const user = encodeURIComponent(env.WAREHOUSE_USER ?? "statcast");
  const password = encodeURIComponent(env.WAREHOUSE_PASSWORD ?? "statcast");
  const host = env.WAREHOUSE_HOST ?? "localhost";
  const port = env.WAREHOUSE_PORT ?? "5432";
  const db = env.WAREHOUSE_DB ?? "statcast";
  return `postgres://${user}:${password}@${host}:${port}/${db}`;
}

/** "2025-06-03 14:00:00.5+00" (timestamptz) or "2025-06-03 14:00:00" (timestamp, read as UTC) → ISO 8601. */
export function pgTimestampToIso(x: string): string {
  let s = x.replace(" ", "T");
  const offset = s.match(/([+-]\d{2})(?::?(\d{2}))?(?::?\d{2})?$/);
  if (offset && offset.index !== undefined && offset.index > 10) {
    s = `${s.slice(0, offset.index)}${offset[1]}:${offset[2] ?? "00"}`;
  } else if (!s.endsWith("Z")) {
    s += "Z";
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? x : d.toISOString();
}

// Numbers come back as numbers (Postgres numeric and bigint are strings by
// default), dates as "YYYY-MM-DD" and timestamps as ISO strings, which is what
// the Python API returned too.
const TYPES = {
  numeric: { to: 1700, from: [1700, 20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
  day: { to: 1082, from: [1082], serialize: (x: unknown) => String(x), parse: (x: string) => x },
  instant: {
    to: 1184,
    from: [1114, 1184],
    serialize: (x: unknown) => (x instanceof Date ? x.toISOString() : String(x)),
    parse: (x: string) => pgTimestampToIso(x),
  },
};

function connect(url: string, connectTimeout: number): Sql {
  return postgres(url, {
    max: 5,
    // Hyperdrive and Workers: skip the extra round trip to fetch array types.
    fetch_types: false,
    prepare: true,
    connect_timeout: connectTimeout,
    idle_timeout: 5,
    types: TYPES,
    onnotice: () => {},
  }) as unknown as Sql;
}

export class DataError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Run `fn` with a warehouse connection, mapping connection and missing-mart errors to 503s. */
export async function withWarehouse<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const cf = await cloudflareEnv();
  const url = cf?.env.HYPERDRIVE?.connectionString ?? warehouseUrlFromEnv();
  const sql = connect(url, 5);
  try {
    return await fn(sql);
  } catch (err) {
    throw toDataError(err);
  } finally {
    const closing = sql.end({ timeout: 2 });
    if (cf?.waitUntil) cf.waitUntil(closing);
    else await closing;
  }
}

/** The Airflow metadata DB, if one is configured; null otherwise. */
export async function airflowConnection(): Promise<{ sql: Sql; close: () => Promise<void> } | { reason: string }> {
  const cf = await cloudflareEnv();
  const url = cf?.env.AIRFLOW_HYPERDRIVE?.connectionString ?? process.env.AIRFLOW_DATABASE_URL;
  if (!url) return { reason: "Airflow metadata DB not connected (AIRFLOW_HYPERDRIVE / AIRFLOW_DATABASE_URL)" };
  const sql = connect(url, 3);
  return {
    sql,
    close: async () => {
      const closing = sql.end({ timeout: 2 });
      if (cf?.waitUntil) cf.waitUntil(closing);
      else await closing;
    },
  };
}

function toDataError(err: unknown): unknown {
  if (err instanceof DataError) return err;
  const e = err as { code?: string; message?: string };
  if (e?.code === "42P01") return new DataError(503, "marts not built yet: run the DAG (or `make backfill`) first");
  const message = String(e?.message ?? err);
  if (
    ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "28P01", "3D000"].includes(
      e?.code ?? "",
    ) ||
    /connect|timeout|password authentication/i.test(message)
  ) {
    return new DataError(503, `warehouse unreachable: ${message.split("\n")[0]}`);
  }
  return err;
}
