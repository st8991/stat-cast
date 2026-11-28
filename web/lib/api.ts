import { DataError } from "./db";

/** JSON response; data errors become `{detail}` with their status, like the FastAPI app. */
export async function respond(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn(), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof DataError) return Response.json({ detail: err.message }, { status: err.status });
    console.error(err);
    return Response.json({ detail: "internal error" }, { status: 500 });
  }
}

/** `?season=2025` → 2025; missing or malformed → null (latest season). */
export function seasonParam(req: Request): number | null {
  const raw = new URL(req.url).searchParams.get("season");
  const n = raw == null ? NaN : Number(raw);
  return Number.isInteger(n) ? n : null;
}
