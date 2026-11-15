import { route } from "@/server/api";
import { setSubscriptionStatus } from "@/server/services/subscriptions";

export const POST = route<{ id: string }>(({ ctx, params, body }) => setSubscriptionStatus(ctx, params.id, body));
