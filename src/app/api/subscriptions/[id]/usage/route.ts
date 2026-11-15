import { route } from "@/server/api";
import { recordUsage } from "@/server/services/subscriptions";

export const POST = route<{ id: string }>(({ ctx, params, body }) => recordUsage(ctx, params.id, body));
