import { route } from "@/server/api";
import { getCatalog } from "@/server/services/catalog";

export const GET = route(({ ctx, search }) => getCatalog(ctx, { activeOnly: search.get("active") === "1" }));
