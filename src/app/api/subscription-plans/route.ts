import { route } from "@/server/api";
import { createPlan, listPlans } from "@/server/services/subscriptions";

export const GET = route(({ ctx }) => listPlans(ctx));
export const POST = route(({ ctx, body }) => createPlan(ctx, body));
