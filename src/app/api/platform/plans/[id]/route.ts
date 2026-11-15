import { route } from "@/server/api";
import { updatePlan } from "@/server/services/platform";

export const PATCH = route<{ id: string }>(({ ctx, params, body }) => updatePlan(ctx, params.id, body));
