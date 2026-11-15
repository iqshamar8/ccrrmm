import { route } from "@/server/api";
import { createSurgery, listSurgeries } from "@/server/services/surgeries";

export const GET = route(({ ctx, search }) =>
  listSurgeries(ctx, {
    status: search.get("status") ?? undefined, from: search.get("from") ?? undefined, to: search.get("to") ?? undefined,
    surgeonId: search.get("surgeonId") ?? undefined, clientId: search.get("clientId") ?? undefined, search: search.get("q") ?? undefined,
  }),
);
export const POST = route(({ ctx, body }) => createSurgery(ctx, body));
