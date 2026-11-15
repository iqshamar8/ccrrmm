import { route } from "@/server/api";
import { stockOverview } from "@/server/services/inventory";

export const GET = route(({ ctx, search }) => stockOverview(ctx, { warehouseId: search.get("warehouseId") ?? undefined, groupId: search.get("groupId") ?? undefined, search: search.get("q") ?? undefined, low: search.get("low") === "1" }));
