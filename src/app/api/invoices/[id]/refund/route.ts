import { route } from "@/server/api";
import { refundInvoice } from "@/server/services/billing";

export const POST = route<{ id: string }>(({ ctx, params, body }) => refundInvoice(ctx, params.id, body));
