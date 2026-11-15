import { route } from "@/server/api";
import { getDashboard } from "@/server/services/dashboard";

export const GET = route(({ ctx, search }) =>
  getDashboard(ctx, {
    from: search.get("from") ?? "", to: search.get("to") ?? "",
    granularity: search.get("granularity") ?? undefined, branchId: search.get("branchId") ?? undefined,
  }),
);
