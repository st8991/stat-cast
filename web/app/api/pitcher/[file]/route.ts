import { respond, seasonParam } from "@/lib/api";
import { DataError, withWarehouse } from "@/lib/db";
import { pitcher } from "@/lib/queries";

export const dynamic = "force-dynamic";

// /api/pitcher/{id}.json: the `.json` suffix keeps the paths the Python app served.
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  return respond(async () => {
    const m = file.match(/^(\d+)(?:\.json)?$/);
    if (!m) throw new DataError(404, `no pitcher ${file}`);
    const id = Number(m[1]);
    const found = await withWarehouse((sql) => pitcher(sql, id, seasonParam(req)));
    if (!found) throw new DataError(404, `no pitcher ${id}`);
    return found;
  });
}
