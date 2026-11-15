import { route } from "@/server/api";
import { createClient, listClients } from "@/server/services/clients";

export const GET = route(({ ctx, search }) =>
  listClients(ctx, {
    search: search.get("q") ?? undefined,
    status: search.get("status") ?? undefined,
    source: search.get("source") ?? undefined,
    tag: search.get("tag") ?? undefined,
    category: search.get("category") ?? undefined,
    branchId: search.get("branchId") ?? undefined,
    ownerId: search.get("ownerId") ?? undefined,
    page: Number(search.get("page") ?? 1),
    pageSize: Number(search.get("pageSize") ?? 25),
    sort: (search.get("sort") as "recent" | "name" | "lastVisit") ?? undefined,
  }),
);
export const POST = route(({ ctx, body }) => createClient(ctx, body));
