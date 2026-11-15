import { route } from "@/server/api";
import { influencerCommissionAction } from "@/server/services/marketing";

/** {action: APPROVE | VOID | PAY, ids[], cashAccountId?} */
export const POST = route<{ id: string }>(({ ctx, params, body }) => influencerCommissionAction(ctx, params.id, body));
