import { route } from "@/server/api";
import { platformAudit, platformStats } from "@/server/services/platform";

export const GET = route(async ({ ctx, search }) =>
  search.get("audit")
    ? platformAudit(ctx, { tenantId: search.get("tenantId") ?? undefined, take: Number(search.get("take") ?? 100) })
    : platformStats(ctx),
);
