import { route } from "@/server/api";
import { saveCashAccount } from "@/server/services/accounting";

export const PATCH = route<{ id: string }>(({ ctx, params, body }) => saveCashAccount(ctx, params.id, body));
