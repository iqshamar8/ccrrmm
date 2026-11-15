import { route } from "@/server/api";
import { performance } from "@/server/services/hr";

export const GET = route(({ ctx, search }) => performance(ctx, { from: search.get("from") ?? "", to: search.get("to") ?? "" }));
