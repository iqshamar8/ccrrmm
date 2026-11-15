import { route } from "@/server/api";
import { runReport } from "@/server/services/reports";

export const GET = route<{ key: string }>(({ ctx, params, search }) => runReport(ctx, params.key, { from: search.get("from"), to: search.get("to"), branchId: search.get("branchId"), days: search.get("days"), lang: search.get("lang") }));
