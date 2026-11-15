import { route } from "@/server/api";
import { createVoucher, listVouchers } from "@/server/services/accounting";

export const GET = route(({ ctx, search }) => listVouchers(ctx, { type: search.get("type") ?? undefined, from: search.get("from") ?? undefined, to: search.get("to") ?? undefined, expensesOnly: search.get("expenses") === "1" }));
export const POST = route(({ ctx, body }) => createVoucher(ctx, body));
