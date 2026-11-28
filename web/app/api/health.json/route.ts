import { respond } from "@/lib/api";
import { airflowConnection, withWarehouse } from "@/lib/db";
import { airflowRuns, warehouseHealth } from "@/lib/queries";
import type { AirflowRuns, Health } from "@/lib/types";

export const dynamic = "force-dynamic";

async function airflow(): Promise<AirflowRuns> {
  const conn = await airflowConnection();
  if ("reason" in conn) return { available: false, reason: conn.reason };
  try {
    return await airflowRuns(conn.sql);
  } catch (err) {
    console.warn("Airflow metadata DB unavailable:", err);
    return { available: false, reason: String((err as Error)?.message ?? err).split("\n")[0].slice(0, 200) };
  } finally {
    await conn.close();
  }
}

export function GET() {
  return respond(async (): Promise<Health> => {
    const [warehouse, af] = await Promise.all([withWarehouse(warehouseHealth), airflow()]);
    return { ...warehouse, airflow: af, mode: "live" };
  });
}
