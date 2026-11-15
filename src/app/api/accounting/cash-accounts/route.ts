import { route } from "@/server/api";
import { listCashAccounts, saveCashAccount } from "@/server/services/accounting";

export const GET = route(({ ctx }) => listCashAccounts(ctx));
export const POST = route(({ ctx, body }) => saveCashAccount(ctx, null, body));
