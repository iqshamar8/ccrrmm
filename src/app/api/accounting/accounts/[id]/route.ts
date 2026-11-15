import { route } from "@/server/api";
import { accountLedger, saveAccount } from "@/server/services/accounting";

type P = { id: string };
/** GET = account ledger with running balance */
export const GET = route<P>(({ ctx, params, search }) => accountLedger(ctx, params.id, { from: search.get("from") ?? undefined, to: search.get("to") ?? undefined, branchId: search.get("branchId") ?? undefined }));
export const PATCH = route<P>(({ ctx, params, body }) => saveAccount(ctx, params.id, body));
