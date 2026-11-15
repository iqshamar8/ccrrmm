import { route } from "@/server/api";
import { renewSubscription } from "@/server/services/subscriptions";

export const POST = route<{ id: string }>(({ ctx, params, body }) => renewSubscription(ctx, params.id, body));
