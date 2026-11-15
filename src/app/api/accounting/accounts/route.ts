import { route } from "@/server/api";
import { listAccounts, saveAccount } from "@/server/services/accounting";

export const GET = route(({ ctx }) => listAccounts(ctx));
export const POST = route(({ ctx, body }) => saveAccount(ctx, null, body));
