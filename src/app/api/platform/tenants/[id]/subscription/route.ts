import { route } from "@/server/api";
import { changeTenantPlan } from "@/server/services/platform";

export const POST = route<{ id: string }>(({ ctx, params, body }) => changeTenantPlan(ctx, params.id, body));
