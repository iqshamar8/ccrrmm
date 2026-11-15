import { route } from "@/server/api";
import { balanceSheet } from "@/server/services/accounting";

export const GET = route(({ ctx, search }) => balanceSheet(ctx, { asOf: search.get("asOf") ?? undefined, branchId: search.get("branchId") ?? undefined }));
