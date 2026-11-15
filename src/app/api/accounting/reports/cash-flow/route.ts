import { route } from "@/server/api";
import { cashFlow } from "@/server/services/accounting";

export const GET = route(({ ctx, search }) => cashFlow(ctx, { from: search.get("from") ?? undefined, to: search.get("to") ?? undefined, branchId: search.get("branchId") ?? undefined }));
