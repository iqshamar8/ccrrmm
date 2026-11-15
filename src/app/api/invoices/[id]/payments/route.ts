import { route } from "@/server/api";
import { addPayment } from "@/server/services/billing";

export const POST = route<{ id: string }>(({ ctx, params, body }) => addPayment(ctx, params.id, body));
