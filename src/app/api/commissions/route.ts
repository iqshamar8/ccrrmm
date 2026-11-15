import { route } from "@/server/api";
import { listCommissions } from "@/server/services/commissions";

export const GET = route(({ ctx, search }) =>
  listCommissions(ctx, { userId: search.get("userId") ?? undefined, status: search.get("status") ?? undefined, source: search.get("source") ?? undefined, from: search.get("from") ?? undefined, to: search.get("to") ?? undefined }),
);
