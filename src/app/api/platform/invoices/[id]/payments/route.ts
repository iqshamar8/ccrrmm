import { route } from "@/server/api";
import { submitPlatformPayment } from "@/server/services/platform-billing";

export const POST = route<{ id: string }>(({ ctx, params, body }) => submitPlatformPayment(ctx, params.id, body));
