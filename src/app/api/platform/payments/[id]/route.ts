import { route } from "@/server/api";
import { reviewPlatformPayment } from "@/server/services/platform-billing";

export const PATCH = route<{ id: string }>(({ ctx, params, body }) => reviewPlatformPayment(ctx, params.id, body));
