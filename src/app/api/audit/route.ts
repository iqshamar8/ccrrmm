import { route } from "@/server/api";
import { listAudit } from "@/server/services/organization";

export const GET = route(({ ctx, search }) =>
  listAudit(ctx, {
    entity: search.get("entity") ?? undefined,
    action: search.get("action") ?? undefined,
    userId: search.get("userId") ?? undefined,
    cursor: search.get("cursor") ?? undefined,
    take: search.get("take") ? Number(search.get("take")) : undefined,
  }),
);
