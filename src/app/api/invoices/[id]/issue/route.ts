import { route } from "@/server/api";
import { issueInvoice } from "@/server/services/billing";

export const POST = route<{ id: string }>(({ ctx, params, body }) => issueInvoice(ctx, params.id, body));
