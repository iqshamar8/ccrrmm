import { route } from "@/server/api";
import { cancelInvoice } from "@/server/services/billing";

export const POST = route<{ id: string }>(({ ctx, params, body }) => cancelInvoice(ctx, params.id, body));
