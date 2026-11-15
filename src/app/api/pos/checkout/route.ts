import { route } from "@/server/api";
import { posCheckout } from "@/server/services/billing";

export const POST = route(({ ctx, body }) => posCheckout(ctx, body));
