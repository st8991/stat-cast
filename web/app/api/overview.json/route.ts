import { respond, seasonParam } from "@/lib/api";
import { withWarehouse } from "@/lib/db";
import { overview } from "@/lib/queries";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return respond(() => withWarehouse((sql) => overview(sql, seasonParam(req))));
}
