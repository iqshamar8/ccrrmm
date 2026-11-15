import { route } from "@/server/api";
import { incomeStatement } from "@/server/services/accounting";

export const GET = route(({ ctx, search }) => incomeStatement(ctx, { from: search.get("from") ?? undefined, to: search.get("to") ?? undefined, branchId: search.get("branchId") ?? undefined, byBranch: search.get("byBranch") === "1" }));
