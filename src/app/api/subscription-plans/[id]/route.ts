import { route } from "@/server/api";
import { deletePlan, updatePlan } from "@/server/services/subscriptions";

type P = { id: string };
export const PATCH = route<P>(({ ctx, params, body }) => updatePlan(ctx, params.id, body));
export const DELETE = route<P>(({ ctx, params }) => deletePlan(ctx, params.id));
