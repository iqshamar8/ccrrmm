import { route } from "@/server/api";
import { getSubscription } from "@/server/services/subscriptions";

export const GET = route<{ id: string }>(({ ctx, params }) => getSubscription(ctx, params.id));
