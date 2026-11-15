import { route } from "@/server/api";
import { createInvoice, listInvoices } from "@/server/services/billing";

export const GET = route(({ ctx, search }) =>
  listInvoices(ctx, {
    status: search.get("status") ?? undefined, type: search.get("type") ?? undefined, clientId: search.get("clientId") ?? undefined,
    from: search.get("from") ?? undefined, to: search.get("to") ?? undefined, search: search.get("q") ?? undefined,
    unpaid: search.get("unpaid") === "1", page: Number(search.get("page") ?? 1),
  }),
);
/** ?issue=1 issues immediately; otherwise saves a draft */
export const POST = route(({ ctx, body, search }) => createInvoice(ctx, body, { issue: search.get("issue") === "1" }));
