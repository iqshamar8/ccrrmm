import { route } from "@/server/api";
import { listSubscriptions, sellSubscription } from "@/server/services/subscriptions";

export const GET = route(({ ctx, search }) =>
  listSubscriptions(ctx, {
    status: search.get("status") ?? undefined, expiringDays: search.get("expiring") ? Number(search.get("expiring")) : undefined,
    clientId: search.get("clientId") ?? undefined, search: search.get("q") ?? undefined,
  }),
);
export const POST = route(({ ctx, body }) => sellSubscription(ctx, body));
