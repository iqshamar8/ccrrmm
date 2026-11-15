import { route } from "@/server/api";
import { trialBalance } from "@/server/services/accounting";

export const GET = route(({ ctx, search }) => trialBalance(ctx, { from: search.get("from") ?? undefined, to: search.get("to") ?? undefined, branchId: search.get("branchId") ?? undefined }));
