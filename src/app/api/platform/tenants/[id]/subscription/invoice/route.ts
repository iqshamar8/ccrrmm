import { route } from "@/server/api";
import { issueSubscriptionInvoice } from "@/server/services/platform-billing";

export const POST = route<{ id: string }>(({ ctx, params, body }) => {
  const b = body as { subscriptionId?: string; kind?: "NEW" | "RENEWAL" };
  return issueSubscriptionInvoice(ctx, params.id, b.subscriptionId ?? "", b.kind ?? "NEW");
});
